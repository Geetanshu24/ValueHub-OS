import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stubAnswer } from './ai-stub.js';

export type AiContent = Anthropic.ContentBlockParam;

// The one place the app talks to Claude. Every use is a suggestion for a person to check: nothing
// that comes back is stored as verified. With no ANTHROPIC_API_KEY the AI features are simply off.
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client?: Anthropic;

  // AI_MODE=stub answers locally with demo answers, so every AI feature can be tried without an account.
  stubbed(): boolean {
    return process.env.AI_MODE === 'stub';
  }

  // AI_MODE=cli asks the Claude Code program on this computer, using the Claude account that is signed in to it.
  // It is for trying the AI on a developer's own machine, not for a shared server.
  cli(): boolean {
    return process.env.AI_MODE === 'cli';
  }

  enabled(): boolean {
    return (this.stubbed() || this.cli() || Boolean(process.env.ANTHROPIC_API_KEY)) && process.env.AI_EXTRACT !== 'false';
  }

  private get model() {
    return process.env.AI_EXTRACT_MODEL ?? 'claude-sonnet-5-5';
  }

  // Asks for JSON matching `schema` and returns it parsed. Throws if the AI is off, refuses or answers with something unusable.
  async json<T>(options: { system: string; content: AiContent[]; schema: object; maxTokens?: number; effort?: 'low' | 'medium' | 'high'; web?: { domains: string[] } }): Promise<T> {
    if (!this.enabled()) throw new ServiceUnavailableException('AI is not set up: add ANTHROPIC_API_KEY to the server settings');
    if (this.stubbed()) return stubAnswer(options.schema, options.content) as T;
    if (this.cli()) return this.viaCli<T>(options);
    this.client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    if (options.web) return this.withWebSearch<T>(options as typeof options & { web: { domains: string[] } });
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens ?? 8000,
      system: options.system,
      output_config: { effort: options.effort ?? 'medium', format: { type: 'json_schema', schema: options.schema } },
      messages: [{ role: 'user', content: options.content }],
    } as never);
    const message = response as unknown as { stop_reason?: string; content: { type: string; text?: string }[] };
    if (message.stop_reason === 'refusal') throw new ServiceUnavailableException('The AI declined this request');
    const text = message.content.find((b) => b.type === 'text')?.text ?? '';
    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.warn(`AI answer was not JSON (stop reason ${message.stop_reason ?? 'unknown'})`);
      throw new ServiceUnavailableException('The AI answer could not be read, please try again');
    }
  }

  // Lets the AI search the web, only on the given domains, then answer in the JSON shape asked for. The search
  // tool and a fixed output format are not used together, so the shape is asked for in words and checked here.
  private async withWebSearch<T>(options: { system: string; content: AiContent[]; schema: object; maxTokens?: number; web: { domains: string[] } }): Promise<T> {
    const client = this.client!;
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: options.content }];
    let text = '';
    for (let turn = 0; turn < 4; turn += 1) {
      const response = await client.messages.create({
        model: this.model,
        max_tokens: options.maxTokens ?? 8000,
        system: `${options.system}\n\nWhen you have finished searching, reply with only one JSON object that matches this JSON schema, and nothing else:\n${JSON.stringify(options.schema)}`,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6, allowed_domains: options.web.domains }],
        messages,
      } as never);
      const message = response as unknown as { stop_reason?: string; content: Anthropic.ContentBlock[] };
      if (message.stop_reason === 'refusal') throw new ServiceUnavailableException('The AI declined this request');
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] });
        continue;
      }
      text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
      break;
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      this.logger.warn('AI web answer was not JSON');
      throw new ServiceUnavailableException('The AI answer could not be read, please try again');
    }
  }

  private async viaCli<T>(options: { system: string; content: AiContent[]; schema: object; web?: { domains: string[] } }): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'valuehub-ai-'));
    try {
      const parts = [options.system, ''];
      if (options.web) parts.push(`Search the web and use only pages on these official domains: ${options.web.domains.join(', ')}.`, '');
      let pictures = 0;
      for (const block of options.content) {
        if (block.type === 'text') parts.push(block.text);
        else if (block.type === 'image' && block.source.type === 'base64') {
          pictures += 1;
          const file = join(dir, `picture-${pictures}.jpg`);
          await writeFile(file, Buffer.from(block.source.data, 'base64'));
          parts.push(`[Picture file: ${file}]`);
        }
      }
      if (pictures > 0) parts.push('Open each picture file above with the Read tool and look at it before you answer.');
      const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(options.schema), '--no-session-persistence', '--tools', [pictures > 0 && 'Read', options.web && 'WebSearch,WebFetch'].filter(Boolean).join(','), '--add-dir', dir];
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn('claude', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        const timer = setTimeout(() => { child.kill(); reject(new ServiceUnavailableException('The AI took too long to answer')); }, 240_000);
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.stderr.on('data', (d: Buffer) => (err += d.toString()));
        child.on('error', () => { clearTimeout(timer); reject(new ServiceUnavailableException('The Claude program is not installed on this computer')); });
        child.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(out); else { this.logger.warn(`claude exited ${code}: ${err.slice(0, 300)}`); reject(new ServiceUnavailableException('The AI could not answer, please try again')); } });
        child.stdin.end(parts.join('\n'));
      });
      const reply = JSON.parse(stdout) as { is_error?: boolean; structured_output?: unknown; result?: string };
      if (reply.is_error) throw new ServiceUnavailableException('The AI could not answer, please try again');
      if (reply.structured_output && typeof reply.structured_output === 'object') return reply.structured_output as T;
      try {
        return JSON.parse(reply.result ?? '') as T;
      } catch {
        throw new ServiceUnavailableException('The AI answer could not be read, please try again');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
