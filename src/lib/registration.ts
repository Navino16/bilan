// Whether /register offers no way to sign up (spec §5.3). Like registerAction, any mode
// other than OPEN or INVITE_ONLY counts as DISABLED; SSO sign-up needs OPEN.
export function isRegistrationClosed(o: {
  mode: string;
  credentialsEnabled: boolean;
  signUpProviders: number;
}): boolean {
  if (o.mode !== "OPEN" && o.mode !== "INVITE_ONLY") return true;
  return !o.credentialsEnabled && (o.mode !== "OPEN" || o.signUpProviders === 0);
}
