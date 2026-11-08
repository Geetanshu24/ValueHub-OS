// Testing aid: with RELAX_CHECKS=true in .env, the mandatory-field and stage-gate
// checks are skipped so a report can be produced end to end from partial data.
// Never enable this in production.
export const relaxChecks = (): boolean => process.env.RELAX_CHECKS === 'true';
