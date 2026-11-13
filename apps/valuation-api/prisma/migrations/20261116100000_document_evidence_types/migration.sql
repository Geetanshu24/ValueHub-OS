-- Market listing screenshots and circle rate copies go into the bank report beside the rate they support.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'MARKET_EVIDENCE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CIRCLE_RATE_COPY';
