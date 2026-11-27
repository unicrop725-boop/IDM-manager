/** True when the backend refused an action because it needs a BoltGrab Pro license. */
export const isProLicenseError = (message: string): boolean => /requires a BoltGrab Pro license/i.test(message);
