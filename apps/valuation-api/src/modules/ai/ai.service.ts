import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export type AiContent = Anthropic.ContentBlockParam;

// The one place the app talks to Claude. Every use is a suggestion for a person to check: nothing
// that comes back is stored as verified. With no ANTHROPIC_API_KEY the AI features are simply off.
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client?: Anthropic;

  enabled(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.AI_EXTRACT !== 'false';
  }

  private get model() {
    return process.env.AI_EXTRACT_MODEL ?? 'claude-sonnet-5-5';
  }

  // Asks for JSON matching `schema` and returns it parsed. Throws if the AI is off, refuses or answers with something unusable.
  async json<T>(options: { system: string; content: AiContent[]; schema: object; maxTokens?: number; effort?: 'low' | 'medium' | 'high' }): Promise<T> {
    if (!this.enabled()) throw new ServiceUnavailableException('AI is not set up: add ANTHROPIC_API_KEY to the server settings');
    this.client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
}
