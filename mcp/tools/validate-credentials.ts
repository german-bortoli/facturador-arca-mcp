import { resolveCredentials } from '../credentials-resolver';
import type { ValidateCredentialsSourceInput } from '../types';

function mask(value: string): string {
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`;
}

export async function validateCredentialsSource(
  input: ValidateCredentialsSourceInput,
) {
  const credentials = await resolveCredentials({
    explicit: input.credentials,
    credentialsCsvText: input.credentialsCsvText,
    preferredIssuerCuit: input.preferredIssuerCuit,
    allowInteractivePrompt: input.allowInteractivePrompt ?? true,
  });

  return {
    ok: true,
    tenantName: credentials.RAZON_SOCIAL,
    issuerCuit: mask(credentials.AFIP_ISSUER_CUIT),
    username: mask(credentials.AFIP_USERNAME),
  };
}
