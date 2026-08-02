import {
  getRuntimeSettingBoolean,
  getRuntimeSettingString,
} from "../system-settings";
import {
  DEFAULT_REGISTRATION_EMAIL_POLICY,
  parseRegistrationEmailDomains,
  type RegistrationEmailPolicy,
} from "./email-domain";

export async function getRuntimeRegistrationEmailPolicy(): Promise<RegistrationEmailPolicy> {
  const configuredDomains = await getRuntimeSettingString(
    "REGISTRATION_EMAIL_ALLOWED_DOMAINS"
  );

  return {
    allowedDomains: parseRegistrationEmailDomains(configuredDomains),
    blockPlusAliases: await getRuntimeSettingBoolean(
      "REGISTRATION_EMAIL_BLOCK_PLUS_ALIASES",
      DEFAULT_REGISTRATION_EMAIL_POLICY.blockPlusAliases
    ),
    blockDottedLocalParts: await getRuntimeSettingBoolean(
      "REGISTRATION_EMAIL_BLOCK_DOTTED_LOCAL_PARTS",
      DEFAULT_REGISTRATION_EMAIL_POLICY.blockDottedLocalParts
    ),
  };
}
