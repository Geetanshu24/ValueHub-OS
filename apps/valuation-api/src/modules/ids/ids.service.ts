import { Injectable } from '@nestjs/common';
import { formatAssignmentCode, formatPropertyCode } from '@value-hub/valuation-shared';
import { Prisma } from '../../generated/prisma/client.js';

// Issues the next number from a per-firm counter. The upsert-increment is a
// single atomic statement, so concurrent creates never get the same number.
// Always call inside the transaction that creates the record.
@Injectable()
export class IdsService {
  async nextValue(tx: Prisma.TransactionClient, firmId: string, key: string): Promise<number> {
    const row = await tx.idSequence.upsert({
      where: { firmId_key: { firmId, key } },
      create: { firmId, key, value: 1 },
      update: { value: { increment: 1 } },
    });
    return row.value;
  }

  async nextPropertyCode(tx: Prisma.TransactionClient, firmId: string): Promise<string> {
    return formatPropertyCode(await this.nextValue(tx, firmId, 'PROP'));
  }

  async nextAssignmentCode(tx: Prisma.TransactionClient, firmId: string, year: number): Promise<string> {
    return formatAssignmentCode(year, await this.nextValue(tx, firmId, `ASG-${year}`));
  }
}
