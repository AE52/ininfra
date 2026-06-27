"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { EnvObject, Namespace } from "@ininfra/shared-types";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { cx } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/Toast";

type Row = { id: number; key: string; value: string; masked: boolean };

let rowSeq = 1;
function toRows(object: EnvObject): Row[] {
  return object.data.map((d) => ({
    id: rowSeq++,
    key: d.key,
    value: d.value,
    masked: d.masked,
  }));
}

/**
 * Focused editor for a SINGLE ConfigMap/Secret object. Adapted from
 * components/EnvEditor's ObjectEditor: searchable rows, secret reveal, and
 * role-gated save (viewers see read-only values + no Save button).
 */
export function EnvObjectEditor({
  ns,
  workload,
  object,
}: {
  ns: Namespace;
  workload: string;
  object: EnvObject;
}) {
  const router = useRouter();
  const toast = useToast();
  const isSecret = object.source === "secret";

  const [rows, setRows] = useState<Row[]>(() => toRows(object));
  const [query, setQuery] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [saving, startSaving] = useTransition();
  const [resourceVersion] = useState(object.resourceVersion);

  // Role gating: assume read-only until me() resolves with role === "admin".
  const [canEdit, setCanEdit] = useState(false);
  const [roleResolved, setRoleResolved] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((m) => {
        if (alive) setCanEdit(m.role === "admin");
      })
      .catch(() => {
        if (alive) setCanEdit(false);
      })
      .finally(() => {
        if (alive) setRoleResolved(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const dirty = useMemo(() => {
    const orig = new Map(object.data.map((d) => [d.key, d.value]));
    if (rows.length !== object.data.length) return true;
    for (const r of rows) {
      if (!orig.has(r.key)) return true;
      if (r.masked && r.value === "••••••") continue;
      if (orig.get(r.key) !== r.value) return true;
    }
    return false;
  }, [rows, object.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        (!r.masked && r.value.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const update = useCallback(
    (id: number, patch: Partial<Row>) =>
      setRows((rs) =>
        rs.map((r) =>
          r.id === id
            ? { ...r, ...patch, masked: patch.value !== undefined ? false : r.masked }
            : r,
        ),
      ),
    [],
  );

  const remove = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addRow = () =>
    setRows((rs) => [...rs, { id: rowSeq++, key: "", value: "", masked: false }]);

  async function revealAll() {
    if (!isSecret) return;
    setRevealing(true);
    try {
      const fresh = await api.getEnv(ns, workload, true);
      const match = fresh.secrets.find((s) => s.name === object.name);
      if (!match) throw new Error("secret no longer present");
      const valueByKey = new Map(match.data.map((d) => [d.key, d.value]));
      setRows((rs) =>
        rs.map((r) =>
          r.masked && valueByKey.has(r.key)
            ? { ...r, value: valueByKey.get(r.key) ?? r.value, masked: false }
            : r,
        ),
      );
      setRevealed(true);
      toast("info", `Revealed ${match.name} (audited)`);
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : String(e);
      toast("error", `Reveal failed: ${msg}`);
    } finally {
      setRevealing(false);
    }
  }

  function save() {
    if (!canEdit) return;
    const stillMasked = rows.some((r) => r.masked && r.value === "••••••");
    if (stillMasked) {
      toast("error", "Reveal secret values before saving to avoid overwriting.");
      return;
    }
    const keys = rows.map((r) => r.key.trim());
    if (keys.some((k) => k === "")) {
      toast("error", "Keys cannot be empty.");
      return;
    }
    if (new Set(keys).size !== keys.length) {
      toast("error", "Duplicate keys are not allowed.");
      return;
    }
    const data: Record<string, string> = {};
    for (const r of rows) data[r.key.trim()] = r.value;

    startSaving(async () => {
      try {
        await api.patchEnv(ns, workload, {
          source: object.source,
          name: object.name,
          resourceVersion,
          data,
        });
        toast("success", `Saved ${object.name}`);
        router.refresh();
      } catch (e) {
        if (e instanceof ApiClientError && e.status === 409) {
          toast("error", "Conflict: object changed on the server. Reloading.");
          router.refresh();
        } else {
          const msg = e instanceof ApiClientError ? e.message : String(e);
          toast("error", `Save failed: ${msg}`);
        }
      }
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <span className="font-mono text-ink-muted">{object.name}</span>
          <span className="text-ink-faint">·</span>
          <span>rv {resourceVersion}</span>
          <Badge
            variant="outline"
            className={cx(
              isSecret
                ? "border-pf-gold/30 bg-pf-gold-50 text-[#8a6d00]"
                : "border-pf-blue/30 bg-pf-blue-50 text-pf-blue",
            )}
          >
            {isSecret ? "Secret" : "ConfigMap"}
          </Badge>
          {roleResolved && !canEdit && (
            <Badge
              variant="outline"
              className="border-line bg-line-soft text-ink-muted"
            >
              Read-only (viewer)
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search keys…"
            className="h-8 w-auto py-1 text-xs"
            spellCheck={false}
          />
          {isSecret && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={revealAll}
              disabled={revealing || revealed}
            >
              {revealed ? "Revealed" : revealing ? "Revealing…" : "Reveal values"}
            </Button>
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-b border-line hover:bg-transparent">
            <TableHead className="w-2/5 px-4 py-2 text-[11px] uppercase tracking-wider text-ink-faint">
              Key
            </TableHead>
            <TableHead className="px-4 py-2 text-[11px] uppercase tracking-wider text-ink-faint">
              Value
            </TableHead>
            <TableHead className="w-10 px-4 py-2" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <EnvRow
              key={r.id}
              row={r}
              isSecret={isSecret}
              canEdit={canEdit}
              onChange={(patch) => update(r.id, patch)}
              onRemove={() => remove(r.id)}
            />
          ))}
          {filtered.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={3}
                className="px-4 py-8 text-center text-sm text-ink-faint"
              >
                {rows.length === 0
                  ? "No keys. Add one below."
                  : "No keys match your search."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {canEdit && (
        <div className="flex items-center gap-2 border-t border-line px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus />
            Add key
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={save}
            disabled={!dirty || saving}
            className="ml-auto"
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function EnvRow({
  row,
  isSecret,
  canEdit,
  onChange,
  onRemove,
}: {
  row: Row;
  isSecret: boolean;
  canEdit: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const [hidden, setHidden] = useState(isSecret && !row.masked);
  const showMaskToggle = isSecret && !row.masked;
  const readOnly = !canEdit || row.masked;

  return (
    <TableRow className="group border-0 hover:bg-transparent">
      <TableCell className="px-4 py-2 align-middle">
        <Input
          value={row.key}
          onChange={(e) => onChange({ key: e.target.value })}
          placeholder="KEY"
          readOnly={!canEdit}
          className={cx("h-9 w-full font-mono", !canEdit && "cursor-default")}
          spellCheck={false}
        />
      </TableCell>
      <TableCell className="px-4 py-2 align-middle">
        <div className="relative">
          <Input
            value={row.value}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={row.masked ? "•••••• (locked)" : "value"}
            readOnly={readOnly}
            type={showMaskToggle && hidden ? "password" : "text"}
            className={cx(
              "h-9 w-full font-mono",
              row.masked && "cursor-not-allowed text-ink-faint",
              !canEdit && !row.masked && "cursor-default",
            )}
            spellCheck={false}
          />
          {showMaskToggle && (
            <button
              type="button"
              onClick={() => setHidden((h) => !h)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink-soft"
              aria-label={hidden ? "show value" : "hide value"}
            >
              {hidden ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </TableCell>
      <TableCell className="px-4 py-2 align-middle">
        {canEdit ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-ink-faint opacity-0 transition-opacity hover:text-pf-red group-hover:opacity-100"
            aria-label="remove key"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <span className="block w-4" />
        )}
      </TableCell>
    </TableRow>
  );
}
