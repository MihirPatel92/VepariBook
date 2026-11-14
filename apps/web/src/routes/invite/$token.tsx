import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatRole } from "@/lib/roles";
import { Logo } from "@/components/ui/Logo";

export const Route = createFileRoute("/invite/$token")({
  component: InviteAcceptPage,
});

type AcceptedInfo = { tenantId: string; tenantName: string };

function InviteAcceptPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: session, isLoading: sessionLoading } = trpc.auth.me.useQuery();
  const { data: canCreateOrg } = trpc.tenant.canCreateOrg.useQuery(undefined, { enabled: !!session?.user });
  const calledRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedInfo | null>(null);

  // Form states for unauthenticated user
  const [mode, setMode] = useState<"register" | "login" | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const acceptMutation = trpc.tenant.acceptInvitation.useMutation();
  const createOrgMutation = trpc.tenant.create.useMutation();
  const registerMutation = trpc.auth.register.useMutation();
  const loginMutation = trpc.auth.login.useMutation();
  const logoutMutation = trpc.auth.logout.useMutation();

  // Peek at invite to show org name, role, email, and whether user already exists
  const { data: inviteInfo, isLoading: peekLoading } = trpc.tenant.peekInvitation.useQuery(
    { token },
    { enabled: !accepted },
  );

  const currentMode = mode ?? (inviteInfo?.hasAccount ? "login" : "register");

  // Auto-accept if user is logged in with matching email
  useEffect(() => {
    if (sessionLoading || peekLoading) return;
    if (!session?.user || !inviteInfo) return;

    if (session.user.email.toLowerCase() !== inviteInfo.email.toLowerCase()) {
      return;
    }

    if (inviteInfo.alreadyAccepted) {
      sessionStorage.removeItem("pendingInviteToken");
      navigate({ to: "/" });
      return;
    }

    if (calledRef.current) return;
    calledRef.current = true;

    (async () => {
      try {
        const data = await acceptMutation.mutateAsync({ token });
        sessionStorage.removeItem("pendingInviteToken");
        await utils.auth.me.refetch();
        await utils.tenant.list.refetch();
        setAccepted(data);
      } catch (err: any) {
        const message = err?.message ?? String(err);
        if (message.includes("already accepted")) {
          sessionStorage.removeItem("pendingInviteToken");
          await utils.auth.me.refetch();
          navigate({ to: "/" });
        } else {
          setError(message);
        }
      }
    })();
  }, [sessionLoading, peekLoading, session, inviteInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await registerMutation.mutateAsync({
        name: name.trim(),
        email: inviteInfo!.email,
        password,
        confirmPassword,
      });
      const data = await acceptMutation.mutateAsync({ token });
      sessionStorage.removeItem("pendingInviteToken");
      await utils.auth.me.refetch();
      await utils.tenant.list.refetch();
      setAccepted(data);
    } catch (err: any) {
      setError(err?.message ?? "Failed to set up account");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await loginMutation.mutateAsync({
        email: inviteInfo!.email,
        password,
      });
      const data = await acceptMutation.mutateAsync({ token });
      sessionStorage.removeItem("pendingInviteToken");
      await utils.auth.me.refetch();
      await utils.tenant.list.refetch();
      setAccepted(data);
    } catch (err: any) {
      setError(err?.message ?? "Invalid password or failed to sign in");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogoutAndSwitch() {
    try {
      await logoutMutation.mutateAsync();
      await utils.auth.me.refetch();
      calledRef.current = false;
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to log out");
    }
  }

  async function handleContinueWithInvited() {
    if (!accepted) return;
    await utils.business.list.refetch();
    navigate({ to: "/", search: { joined: accepted.tenantName } });
  }

  async function handleCreateOwn() {
    try {
      await createOrgMutation.mutateAsync();
      await utils.auth.me.refetch();
      await utils.tenant.list.refetch();
      await utils.business.list.refetch();
      navigate({ to: "/settings" });
    } catch {
      await utils.business.list.refetch();
      navigate({ to: "/" });
    }
  }

  const isActing = createOrgMutation.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-surface-1">
      <div className="w-full max-w-[440px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <Logo className="w-9 h-9" />
          <span className="font-semibold text-lg tracking-tight text-text-primary">
            Vrunda Infotech
          </span>
        </div>

        {/* ── State 1: Accepted Success Screen ── */}
        {accepted ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-text-primary mb-1 text-center">
              You've joined {accepted.tenantName}!
            </h1>
            <p className="text-sm text-text-tertiary mb-6 text-center">
              You're all set. Jump right into your dashboard.
            </p>

            <div className="space-y-3">
              <button
                onClick={handleContinueWithInvited}
                disabled={isActing}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 border-brand-200 bg-brand-50/50 hover:border-brand-400 hover:bg-brand-50 transition-colors text-left group dark:border-brand-600/30 dark:bg-brand-600/10 dark:hover:border-brand-500"
              >
                <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center text-white font-semibold text-lg shrink-0">
                  {accepted.tenantName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary group-hover:text-brand-700 dark:group-hover:text-brand-400">
                    Continue to {accepted.tenantName}
                  </p>
                  {inviteInfo && (
                    <p className="text-xs text-text-tertiary">as {formatRole(inviteInfo.role)}</p>
                  )}
                </div>
              </button>

              {canCreateOrg && (
                <>
                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border-light" /></div>
                    <div className="relative flex justify-center"><span className="bg-surface-0 px-3 text-xs text-text-tertiary">or</span></div>
                  </div>

                  <button
                    onClick={handleCreateOwn}
                    disabled={isActing}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border-light hover:border-border-medium hover:bg-surface-1 transition-colors text-sm font-medium text-text-secondary"
                  >
                    {createOrgMutation.isPending ? "Creating..." : "I also want my own organization"}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (sessionLoading || peekLoading) ? (
          /* ── State 2: Loading peek/session ── */
          <div className="text-center py-6">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-brand-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h1 className="text-base font-semibold text-text-primary mb-1">
              Loading invitation...
            </h1>
            <p className="text-sm text-text-tertiary">
              Verifying your invitation link
            </p>
          </div>
        ) : !inviteInfo ? (
          /* ── State 3: Invalid or Expired Invitation ── */
          <div className="text-center py-4">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-2">
              Invitation Expired or Invalid
            </h1>
            <p className="text-sm text-text-tertiary mb-6">
              This invitation link is either invalid or has already been used. Please ask your administrator to send a new invitation.
            </p>
            <button
              onClick={() => navigate({ to: "/login" })}
              className="btn-primary w-full py-2.5"
            >
              Go to sign in
            </button>
          </div>
        ) : inviteInfo.alreadyAccepted ? (
          /* ── State 3.5: Invitation Already Accepted ── */
          <div className="text-center py-4">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-text-primary mb-2">
              Invitation Already Accepted
            </h1>
            <p className="text-sm text-text-tertiary mb-6">
              The account for <span className="font-semibold text-text-primary">{inviteInfo.email}</span> has already accepted this invitation and joined <span className="font-semibold text-text-primary">{inviteInfo.tenantName}</span>.
            </p>
            <button
              onClick={() => navigate({ to: "/login" })}
              className="btn-primary w-full py-2.5 justify-center"
            >
              Sign in to your account
            </button>
          </div>
        ) : session?.user && session.user.email.toLowerCase() !== inviteInfo.email.toLowerCase() ? (
          /* ── State 4: Signed in with different email ── */
          <div className="py-2">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
              <svg className="w-6 h-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-2 text-center">
              Email mismatch
            </h1>
            <p className="text-sm text-text-secondary mb-4 text-center">
              You are currently signed in as <span className="font-semibold text-text-primary">{session.user.email}</span>.
            </p>
            <p className="text-xs text-text-tertiary mb-6 text-center">
              This invitation was sent to <span className="font-semibold text-brand-600">{inviteInfo.email}</span>. To accept, sign out and continue with {inviteInfo.email}.
            </p>
            <div className="space-y-3">
              <button
                onClick={handleLogoutAndSwitch}
                disabled={logoutMutation.isPending}
                className="btn-primary w-full py-2.5"
              >
                {logoutMutation.isPending ? "Signing out..." : `Switch to ${inviteInfo.email}`}
              </button>
              <button
                onClick={() => navigate({ to: "/" })}
                className="w-full py-2.5 rounded-lg border border-border-light hover:bg-surface-1 transition-colors text-sm font-medium text-text-secondary"
              >
                Return to dashboard
              </button>
            </div>
          </div>
        ) : session?.user ? (
          /* ── State 5: Already authenticated, accepting in background ── */
          <div className="text-center py-6">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-brand-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-1">
              Joining {inviteInfo.tenantName}...
            </h1>
            <p className="text-sm text-text-tertiary">
              Accepting invitation as {formatRole(inviteInfo.role)}
            </p>
            {error && (
              <div className="mt-4 p-3 rounded-lg text-xs bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}
          </div>
        ) : (
          /* ── State 6: Unauthenticated user — Set Password / Register / Login ── */
          <div>
            <div className="mb-6 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-xs font-medium mb-3 dark:bg-brand-950 dark:border-brand-800 dark:text-brand-300">
                <span>{inviteInfo.tenantName}</span>
                <span>•</span>
                <span>{formatRole(inviteInfo.role)}</span>
              </div>
              <h1 className="text-2xl font-bold text-text-primary tracking-tight mb-1">
                {currentMode === "register" ? "Set up your account" : "Welcome back"}
              </h1>
              <p className="text-sm text-text-tertiary">
                {currentMode === "register"
                  ? "Choose a password to join and start using your account."
                  : `Enter your password for ${inviteInfo.email} to join.`}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl text-xs bg-red-50 border border-red-200 text-red-700 dark:bg-red-950 dark:border-red-900 dark:text-red-300">
                {error}
              </div>
            )}

            {currentMode === "register" ? (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="label">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                    className="input"
                    placeholder="Enter your name"
                  />
                </div>

                <div>
                  <label className="label">Email address</label>
                  <input
                    type="email"
                    value={inviteInfo.email}
                    disabled
                    className="input bg-surface-2 opacity-80 cursor-not-allowed text-text-secondary"
                  />
                </div>

                <div>
                  <label className="label">Set Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="input"
                    placeholder="At least 8 characters"
                  />
                </div>

                <div>
                  <label className="label">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    className="input"
                    placeholder="Re-enter your password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary w-full py-2.5 justify-center font-semibold text-sm mt-2"
                >
                  {isSubmitting ? "Setting up account..." : `Set Password & Join`}
                </button>

                <p className="text-center text-xs text-text-tertiary pt-2">
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode("login");
                    }}
                    className="text-brand-600 hover:underline font-medium"
                  >
                    Sign in here
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="label">Email address</label>
                  <input
                    type="email"
                    value={inviteInfo.email}
                    disabled
                    className="input bg-surface-2 opacity-80 cursor-not-allowed text-text-secondary"
                  />
                </div>

                <div>
                  <label className="label">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoFocus
                    className="input"
                    placeholder="Enter your password"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-primary w-full py-2.5 justify-center font-semibold text-sm mt-2"
                >
                  {isSubmitting ? "Signing in..." : `Sign In & Join`}
                </button>

                <p className="text-center text-xs text-text-tertiary pt-2">
                  Need to create a new password?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setMode("register");
                    }}
                    className="text-brand-600 hover:underline font-medium"
                  >
                    Set up password
                  </button>
                </p>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
