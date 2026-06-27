"use client";

import { useCallback, useEffect, useState } from "react";
import type { Page, Role, User } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cx, fmtTime, timeAgo } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

const PAGE_SIZE = 25;

function roleChipCls(role: Role): string {
  if (role === "super_admin") return "bg-pf-yellow-50 text-yellow-700";
  if (role === "admin") return "bg-pf-blue-50 text-pf-blue";
  return "bg-line-soft text-ink-muted";
}

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : String(e);
}

export default function UsersPage() {
  const toast = useToast();
  const t = useT();

  const [role, setRole] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);

  // me() on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.me();
        if (alive) setRole(me.role);
      } catch (e) {
        if (alive) setMeError(errMsg(e));
      } finally {
        if (alive) setMeReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!meReady) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker={t.users.kicker} title={t.users.title} />
        <Card className="p-12 text-center text-sm text-ink-faint">
          {t.users.loading}
        </Card>
      </div>
    );
  }

  if (meError || (role !== "admin" && role !== "super_admin")) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker={t.users.kicker} title={t.users.title} />
        <EmptyState
          title={t.users.adminsOnly}
          body={
            meError
              ? t.users.cannotVerifyRole(meError)
              : t.users.adminsOnlyBody
          }
        />
      </div>
    );
  }

  return <UsersAdmin toast={toast} currentRole={role!} />;
}

function UsersAdmin({
  toast,
  currentRole,
}: {
  toast: (tone: "success" | "error" | "info", text: string) => void;
  currentRole: string;
}) {
  const t = useT();
  const [items, setItems] = useState<User[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Stack of cursors used to reach the CURRENT page (last entry = current page cursor).
  const [stack, setStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (cursor: string | null) => {
    setLoading(true);
    setListErr(null);
    try {
      const page: Page<User> = await api.listUsers({
        cursor: cursor ?? undefined,
        limit: PAGE_SIZE,
      });
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setTotal(page.total ?? null);
    } catch (e) {
      setListErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload the current page (after a mutation), keeping pagination position.
  const reload = useCallback(() => {
    return load(stack[stack.length - 1]);
  }, [load, stack]);

  useEffect(() => {
    void load(null);
  }, [load]);

  function goNext() {
    if (!nextCursor) return;
    const cursor = nextCursor;
    setStack((s) => [...s, cursor]);
    void load(cursor);
  }

  function goPrev() {
    if (stack.length <= 1) return;
    const next = stack.slice(0, -1);
    setStack(next);
    void load(next[next.length - 1]);
  }

  const hasPrev = stack.length > 1;

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.users.kicker}
        title={t.users.title}
        subtitle={t.users.subtitle}
        actions={
          <Button type="button" onClick={() => setShowCreate(true)}>
            {t.users.addUserBtn}
          </Button>
        }
      />

      <CreateUserForm
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(u) => {
          toast("success", t.users.toastCreated(u.username));
          setShowCreate(false);
          void reload();
        }}
        toast={toast}
        currentRole={currentRole}
      />

      {listErr && (
        <div className="mb-4 rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-2.5 text-sm text-pf-red">
          {listErr}
        </div>
      )}

      {items.length === 0 && !loading && !listErr ? (
        <EmptyState title={t.users.noUsers} body={t.users.noUsersBody} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[720px] text-sm">
              <TableHeader>
                <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <TableHead className="px-4 py-2.5 font-medium">{t.users.colUsername}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t.users.colRole}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t.users.colCreated}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t.users.colLastLogin}</TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">{t.users.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((u) => (
                  <UserRow
                    key={u.id}
                    user={u}
                    onChanged={reload}
                    toast={toast}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">
          {loading
            ? t.users.loading
            : total != null
              ? t.users.usersTotal(total)
              : t.users.usersShown(items.length)}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={!hasPrev || loading}
          >
            {t.users.prev}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={!nextCursor || loading}
          >
            {t.users.next}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  onChanged,
  toast,
}: {
  user: User;
  onChanged: () => void;
  toast: (tone: "success" | "error" | "info", text: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      toast("error", `${label} failed: ${errMsg(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function cycleRole() {
    const order: Role[] = ["developer", "admin"];
    const current = order.indexOf(user.role as Role);
    const next: Role =
      current >= 0 && current < order.length - 1
        ? order[current + 1]
        : order[0];
    const ok = await run("Role change", () =>
      api.updateUser(user.id, { role: next }),
    );
    if (ok) toast("success", t.users.toastRoleChanged(user.username, next));
  }

  async function resetPassword() {
    const pw = window.prompt(t.users.promptNewPassword(user.username));
    if (pw == null) return;
    if (pw.length < 8) {
      toast("error", t.users.passwordMinLength);
      return;
    }
    const ok = await run("Password reset", () =>
      api.updateUser(user.id, { password: pw }),
    );
    if (ok) toast("success", t.users.toastPasswordReset(user.username));
  }

  async function remove() {
    if (!window.confirm(t.users.confirmDeleteUser(user.username))) return;
    const ok = await run("Delete", () => api.deleteUser(user.id));
    if (ok) toast("success", t.users.toastDeleted(user.username));
  }

  return (
    <TableRow className="border-b border-line transition-colors last:border-0 hover:bg-line-soft">
      <TableCell className="px-4 py-3 font-medium text-ink">{user.username}</TableCell>
      <TableCell className="px-4 py-3">
        <Badge
          variant="outline"
          className={cx(
            "border-transparent text-[11px] font-medium",
            roleChipCls(user.role),
          )}
        >
          {user.role}
        </Badge>
      </TableCell>
      <TableCell className="px-4 py-3 text-xs text-ink-muted" title={fmtTime(user.createdAt)}>
        {timeAgo(user.createdAt)}
      </TableCell>
      <TableCell
        className="px-4 py-3 text-xs text-ink-muted"
        title={user.lastLogin ? fmtTime(user.lastLogin) : undefined}
      >
        {user.lastLogin ? timeAgo(user.lastLogin) : <span className="text-ink-faint">{t.users.never}</span>}
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={cycleRole}
            disabled={busy || user.role === "super_admin"}
          >
            {user.role === "developer" ? t.users.makeAdmin : t.users.makeDeveloper}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={resetPassword}
            disabled={busy}
          >
            {t.users.resetPassword}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={remove}
            disabled={busy}
          >
            {t.users.deleteBtn}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreateUserForm({
  open,
  onClose,
  onCreated,
  toast,
  currentRole,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (u: User) => void;
  toast: (tone: "success" | "error" | "info", text: string) => void;
  currentRole: string;
}) {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const usernameOk = username.trim().length > 0;
  const passwordOk = password.length >= 8;
  const canSubmit = usernameOk && passwordOk && !submitting;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErr(null);
    try {
      const u = await api.createUser({
        username: username.trim(),
        password,
        role,
      });
      onCreated(u);
    } catch (ex) {
      setErr(errMsg(ex));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold text-ink">
            {t.users.createDialogTitle}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label-kicker mb-1.5 block" htmlFor="cu-username">
              {t.users.createUsername}
            </label>
            <Input
              id="cu-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>

          <div>
            <label className="label-kicker mb-1.5 block" htmlFor="cu-password">
              {t.users.createPassword}
            </label>
            <Input
              id="cu-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <p
              className={cx(
                "mt-1 text-xs",
                password.length > 0 && !passwordOk
                  ? "text-pf-red"
                  : "text-ink-faint",
              )}
            >
              {t.users.createPasswordHint}
            </p>
          </div>

          <div>
            <label className="label-kicker mb-1.5 block" htmlFor="cu-role">
              {t.users.createRole}
            </label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as Role)}
            >
              <SelectTrigger id="cu-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="developer">developer</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
                {currentRole === "super_admin" && (
                  <SelectItem value="super_admin">super_admin</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>

          {err && (
            <div className="rounded-pf border border-pf-red/30 bg-pf-red-50 px-3 py-2 text-sm text-pf-red">
              {err}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
              {t.users.createCancelBtn}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {submitting ? t.users.createSubmittingBtn : t.users.createSubmitBtn}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
