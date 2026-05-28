import { cleanEnv, str, url, makeValidator, type ValidatorSpec } from "envalid";

const base64Key32 = makeValidator((v) => {
  const buf = Buffer.from(v, "base64");
  if (buf.length !== 32) throw new Error("must decode to 32 bytes (base64)");
  return v;
});

const throwingReporter = <T>({ errors }: { errors: Partial<Record<keyof T, Error>> }) => {
  const keys = Object.keys(errors);
  if (keys.length > 0) {
    throw new Error(`Invalid environment variables: ${keys.join(", ")}`);
  }
};

const spec = {
  NODE_ENV: str({ choices: ["development", "test", "production"] }),
  APP_URL: url(),
  DATABASE_URL: str(),
  AUTH_SECRET: str({ devDefault: "x".repeat(32) }),
  DATA_ENCRYPTION_KEY: base64Key32(),
  SEARCH_TOKEN_KEY: base64Key32(),
} satisfies Record<string, ValidatorSpec<unknown>>;

export function parseEnv(source: Record<string, string | undefined>) {
  return cleanEnv(source, spec, { reporter: throwingReporter });
}

type Env = ReturnType<typeof parseEnv>;

let cached: Env | undefined;

export const env = new Proxy({} as Env, {
  get(_target, prop) {
    cached ??= parseEnv(process.env);
    return cached[prop as keyof Env];
  },
});
