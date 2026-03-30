export function isUserAccountExpired(accountExpiresAt?: Date | string | null, now = new Date()): boolean {
  if (!accountExpiresAt) {
    return false;
  }

  const expirationDate = accountExpiresAt instanceof Date ? accountExpiresAt : new Date(accountExpiresAt);
  if (Number.isNaN(expirationDate.getTime())) {
    return false;
  }

  return expirationDate.getTime() <= now.getTime();
}
