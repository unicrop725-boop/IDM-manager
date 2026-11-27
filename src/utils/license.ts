/** True when the backend refused an action because it needs a FlowGet Pro license. */
export const isProLicenseError = (message: string): boolean => /requires a FlowGet Pro license/i.test(message);
