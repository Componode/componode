import { PlusIcon, XIcon } from "lucide-react";
import { useCredentials } from "@/api/hooks/credentials";
import { Button } from "@/ux/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ux/components/ui/select";
import { CHECK_AUTH_MODE_META, type UrlCheckAuthMode } from "@/ux/lib/domain";

const NONE = "__none__";
export interface HeaderRow {
  name: string;
  key: string;
}

export function UrlCheckAuthFields({
  idPrefix,
  authMode,
  setAuthMode,
  credentialId,
  setCredentialId,
  usernameKey,
  setUsernameKey,
  passwordKey,
  setPasswordKey,
  tokenKey,
  setTokenKey,
  headers,
  setHeaders,
}: {
  idPrefix: string;
  authMode: UrlCheckAuthMode;
  setAuthMode: (v: UrlCheckAuthMode) => void;
  credentialId: string;
  setCredentialId: (v: string) => void;
  usernameKey: string;
  setUsernameKey: (v: string) => void;
  passwordKey: string;
  setPasswordKey: (v: string) => void;
  tokenKey: string;
  setTokenKey: (v: string) => void;
  headers: HeaderRow[];
  setHeaders: (v: HeaderRow[]) => void;
}) {
  const credentials = useCredentials();
  const list = credentials.data?.credentials ?? [];
  const unavailable = credentials.isError;
  const selected = list.find((c) => c.id === credentialId) ?? null;
  const keys = selected ? Object.keys(selected.keyHints ?? {}) : [];
  const setHeader = (i: number, p: Partial<HeaderRow>) =>
    setHeaders(headers.map((h, j) => (j === i ? { ...h, ...p } : h)));
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-auth-mode`}>
          Authentication
        </FieldLabel>
        <Select
          value={authMode}
          onValueChange={(v) => setAuthMode(v as UrlCheckAuthMode)}
        >
          <SelectTrigger id={`${idPrefix}-auth-mode`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CHECK_AUTH_MODE_META) as UrlCheckAuthMode[]).map(
              (m) => (
                <SelectItem
                  key={m}
                  value={m}
                  disabled={unavailable && m !== "NONE"}
                >
                  {CHECK_AUTH_MODE_META[m].label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        <FieldDescription>
          {unavailable
            ? "Credential selection requires the Admin role."
            : `${CHECK_AUTH_MODE_META[authMode].description}.`}
        </FieldDescription>
      </Field>
      {authMode !== "NONE" && !unavailable && (
        <>
          <Field>
            <FieldLabel htmlFor={`${idPrefix}-credential`}>
              Credential
            </FieldLabel>
            <Select
              value={credentialId || NONE}
              onValueChange={(v) => setCredentialId(v === NONE ? "" : v)}
            >
              <SelectTrigger id={`${idPrefix}-credential`} className="w-full">
                <SelectValue placeholder="Select a credential" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Select a credential</SelectItem>
                {list.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              {keys.length
                ? `Keys in this credential: ${keys.join(", ")}`
                : "Secret values stay encrypted — the probe resolves key names at run time."}
            </FieldDescription>
          </Field>
          {authMode === "BASIC" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-username-key`}>
                  Username key
                </FieldLabel>
                <Input
                  id={`${idPrefix}-username-key`}
                  value={usernameKey}
                  onChange={(e) => setUsernameKey(e.target.value)}
                  autoComplete="off"
                  className="font-mono"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-password-key`}>
                  Password key
                </FieldLabel>
                <Input
                  id={`${idPrefix}-password-key`}
                  value={passwordKey}
                  onChange={(e) => setPasswordKey(e.target.value)}
                  autoComplete="off"
                  className="font-mono"
                />
              </Field>
            </div>
          )}
          {authMode === "BEARER" && (
            <Field>
              <FieldLabel htmlFor={`${idPrefix}-token-key`}>
                Token key
              </FieldLabel>
              <Input
                id={`${idPrefix}-token-key`}
                value={tokenKey}
                onChange={(e) => setTokenKey(e.target.value)}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          )}
          {authMode === "CUSTOM_HEADERS" && (
            <Field>
              <FieldLabel>Custom headers</FieldLabel>
              <div className="flex flex-col gap-2">
                {headers.map((h, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      aria-label={`Header name ${i + 1}`}
                      value={h.name}
                      onChange={(e) => setHeader(i, { name: e.target.value })}
                      placeholder="X-Api-Key"
                      autoComplete="off"
                      className="font-mono"
                    />
                    <Input
                      aria-label={`Credential key ${i + 1}`}
                      value={h.key}
                      onChange={(e) => setHeader(i, { key: e.target.value })}
                      placeholder="credential key"
                      autoComplete="off"
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove header ${i + 1}`}
                      onClick={() =>
                        setHeaders(headers.filter((_, j) => j !== i))
                      }
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setHeaders([...headers, { name: "", key: "" }])
                    }
                  >
                    <PlusIcon data-icon="inline-start" />
                    Add header
                  </Button>
                </div>
              </div>
              <FieldDescription>
                Header values come from credential key names.{" "}
                <code className="font-mono">Authorization</code> is reserved for
                Basic and Bearer modes.
              </FieldDescription>
            </Field>
          )}
        </>
      )}
    </FieldGroup>
  );
}
