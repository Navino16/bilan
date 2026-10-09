import type { Locale } from "@/i18n/config";
import { NAME_MAX } from "@/lib/validation/name";

type Input = {
  appName: string;
  inviter: string;
  group: string;
  acceptUrl: string;
  code: string;
  ttlDays: number;
};

// User-chosen names go into plain text and the Subject header: one line, bounded.
export function oneLine(value: string, max = NAME_MAX): string {
  const flat = value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const TEMPLATES: Record<Locale, (i: Input) => { subject: string; text: string }> = {
  fr: ({ appName, inviter, group, acceptUrl, code, ttlDays }) => ({
    subject: `${appName} — invitation à rejoindre le foyer « ${group} »`,
    text: [
      `${inviter} vous invite à rejoindre le foyer « ${group} » sur ${appName}.`,
      "",
      `Lien : ${acceptUrl}`,
      `Code : ${code}`,
      "",
      `L’invitation expire dans ${ttlDays} jours.`,
    ].join("\n"),
  }),
  en: ({ appName, inviter, group, acceptUrl, code, ttlDays }) => ({
    subject: `${appName} — invitation to join the household “${group}”`,
    text: [
      `${inviter} invited you to join the household “${group}” on ${appName}.`,
      "",
      `Link: ${acceptUrl}`,
      `Code: ${code}`,
      "",
      `The invitation expires in ${ttlDays} days.`,
    ].join("\n"),
  }),
};

export function invitationMail(locale: Locale, input: Input): { subject: string; text: string } {
  return TEMPLATES[locale]({
    ...input,
    inviter: oneLine(input.inviter),
    group: oneLine(input.group),
  });
}
