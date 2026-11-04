const MIN_SECRET_LENGTH = 32;

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
}

export function jwtExpiresIn(): string {
  return process.env.JWT_EXPIRES_IN ?? '8h';
}
