import {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense
} from "react";
import {
  ShieldCheckIcon,
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  ChatCircleDotsIcon,
  PlusIcon,
  SignOutIcon,
  XIcon,
  ArrowLeftIcon
} from "@phosphor-icons/react";
import type { RehearsalState } from "./deployment/rehearsal";
import type { Run } from "./deployment/lifecycle";
import { CHECK_CATALOG } from "./analysis/advisory";
import {
  api,
  ApiError,
  phases,
  terminal,
  short,
  date,
  prLabel,
  healthSamples,
  stats,
  type RunView
} from "./dashboard/model";
const DeploymentChat = lazy(() => import("./dashboard/chat"));

function Status({ run }: { run: Run }) {
  return (
    <span className={`status status-${run.phase}`}>
      <span className="status-dot" />
      {phases[run.phase]}
    </span>
  );
}
function Id({ value }: { value?: string }) {
  return <code title={value}>{short(value)}</code>;
}
function SignIn({ onSignIn }: { onSignIn: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className="login">
      <div className="brand">
        <ShieldCheckIcon size={28} weight="duotone" />
        DeployGuard
      </div>
      <section className="login-content">
        <h1>
          Safer releases.
          <br />
          Evidence at every step.
        </h1>
        <p>
          Inspect your Worker deployments, review canary health, and approve the
          next release.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/api/session", { token });
              setToken("");
              onSignIn();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="admin-token">Admin token</label>
          <input
            id="admin-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            placeholder="Enter your DeployGuard admin token"
          />
          <p className="field-help">
            Use DEPLOYGUARD_ADMIN_TOKEN from your .dev.vars file. Your token is
            never saved in browser storage.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy || !token.trim()}>
            {busy ? "Signing in…" : "Open dashboard"}
            <ArrowUpRightIcon size={17} />
          </button>
        </form>
      </section>
      <footer>One account. One demo Worker. Deterministic safety.</footer>
    </main>
  );
}
function NewRun({
  locked,
  onCreated
}: {
  locked: boolean;
  onCreated: (run: Run) => void;
}) {
  const [candidate, setCandidate] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [sha, setSha] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="new-run"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const run = await api<Run>("/api/deployment/start", {
            candidate: candidate.trim(),
            ...(prUrl.trim()
              ? {
                  prUrl: prUrl.trim(),
                  ...(sha.trim() ? { expectedCommitSha: sha.trim() } : {})
                }
              : {})
          });
          onCreated(run);
        } catch (error) {
          setError(
            `${(error as Error).message} Refresh run state before trying again; a timed-out request may have been accepted.`
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>New deployment</h2>
      <p className="muted">
        Choose an already uploaded version. Validation and smoke tests run
        first; passing candidates receive 10% of traffic. Full promotion
        requires your approval.
      </p>
      <div className="form-grid">
        <div>
          <label htmlFor="candidate">Candidate version UUID</label>
          <input
            id="candidate"
            required
            value={candidate}
            onChange={(e) => setCandidate(e.target.value)}
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            placeholder="Uploaded Worker version UUID"
          />
        </div>
        <div>
          <label htmlFor="pr">
            GitHub PR URL <span className="muted">optional</span>
          </label>
          <input
            id="pr"
            type="url"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/1"
          />
        </div>
      </div>
      {prUrl && (
        <div className="sha-field">
          <label htmlFor="sha">
            Expected commit SHA <span className="muted">optional</span>
          </label>
          <input
            id="sha"
            value={sha}
            onChange={(e) => setSha(e.target.value)}
            pattern="[0-9a-fA-F]{40}"
            placeholder="Pin the expected PR head"
          />
        </div>
      )}
      {locked && (
        <p className="notice">
          The target is locked by an active or unresolved run.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={locked || busy}>
        {busy ? "Starting…" : "Start validation"}
        <ArrowUpRightIcon size={16} />
      </button>
    </form>
  );
}
function Health({
  view,
  now,
  live
}: {
  view: RunView;
  now: number;
  live: boolean;
}) {
  const run = view.run;
  const samples = healthSamples(run, now);
  const rollback = Boolean(run.rollbackVerification);
  const versions = rollback
    ? [run.stable]
    : [run.stable, run.candidate].filter(Boolean);
  const endpoints = ["/health", "/api/greeting?name=DeployGuard"];
  return (
    <section className="health section">
      <div className="section-heading">
        <h2>{rollback ? "Recovery verification" : "Canary health"}</h2>
        <span className="muted">
          {live && !terminal(run)
            ? "Live synthetic probes"
            : "Recorded synthetic probes"}
        </span>
      </div>
      <p className="muted section-intro">
        {rollback
          ? "Ordinary traffic must serve healthy stable responses for a clean 30-second window. The run stays locked until verified."
          : "Candidate and stable responses are attributed by version. Missing evidence never counts as healthy."}
      </p>
      {!samples.length ? (
        <div className="empty-inline">
          No health samples yet. Evidence appears after smoke testing and
          deployment confirmation.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="health-table">
            <caption className="sr-only">
              Health evidence by endpoint and version
            </caption>
            <thead>
              <tr>
                <th>Endpoint / version</th>
                <th>Samples</th>
                <th>HTTP errors</th>
                <th>p95 latency</th>
                <th>Assertions</th>
                <th>Unknown</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.flatMap((endpoint) =>
                versions.map((version) => {
                  const group = samples.filter(
                    (s) => s.version === version && s.endpoint === endpoint
                  );
                  const stat = stats(group);
                  return (
                    <tr key={endpoint + version}>
                      <th>
                        <span>{endpoint.split("?")[0]}</span>
                        <small>
                          <span
                            className={`version-dot ${version === run.stable ? "stable" : "candidate"}`}
                          />
                          {version === run.stable ? "Stable" : "Candidate"}{" "}
                          <Id value={version} />
                          {run.promotionAt &&
                          !rollback &&
                          version === run.stable
                            ? " · frozen baseline"
                            : ""}
                        </small>
                      </th>
                      <td>{stat.count}</td>
                      <td>
                        {stat.rate}
                        <small>{stat.http} errors</small>
                      </td>
                      <td>{stat.p95}</td>
                      <td className={stat.assertions ? "danger-text" : ""}>
                        {stat.assertions}
                      </td>
                      <td className={stat.unknown ? "warning-text" : ""}>
                        {stat.unknown}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="health-foot">
        <span>
          Decision:{" "}
          <strong>
            {view.health.decision ??
              (terminal(run) ? "See recorded outcome" : "Not evaluated")}
          </strong>
        </span>
        <span>Sampled traffic · not global health coverage</span>
      </div>
      {samples.length > 0 && (
        <details className="evidence">
          <summary>Inspect response evidence ({samples.length})</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Endpoint</th>
                  <th>Expected</th>
                  <th>Observed</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {samples
                  .slice(-40)
                  .reverse()
                  .map((sample) => (
                    <tr key={sample.id}>
                      <td>{new Date(sample.at).toLocaleTimeString()}</td>
                      <td>{sample.endpoint.split("?")[0]}</td>
                      <td>
                        <Id value={sample.version} />
                      </td>
                      <td>
                        {sample.observedVersion ? (
                          <Id value={sample.observedVersion} />
                        ) : (
                          "Not recorded"
                        )}
                      </td>
                      <td>{sample.outcome.replaceAll("_", " ")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {rollback && run.samples.length > 0 && (
        <details className="evidence">
          <summary>
            Canary evidence before rollback ({run.samples.length})
          </summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Version</th>
                  <th>Result</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {run.samples.map((sample) => (
                  <tr key={sample.id}>
                    <td>{sample.endpoint.split("?")[0]}</td>
                    <td>
                      {sample.version === run.candidate
                        ? "Candidate"
                        : "Stable"}{" "}
                      <Id value={sample.version} />
                    </td>
                    <td
                      className={
                        sample.outcome === "assertion_failure"
                          ? "danger-text"
                          : ""
                      }
                    >
                      {sample.outcome.replaceAll("_", " ")}
                    </td>
                    <td>{new Date(sample.at).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
function Analysis({ view }: { view: RunView }) {
  const record = view.analysis;
  return (
    <section className="section analysis">
      <div className="section-heading">
        <h2>PR analysis</h2>
        <span className="advisory-label">AI advisory</span>
      </div>
      {!record ? (
        <p className="empty-inline">
          {view.run.phase === "analyzing"
            ? "Retrieving the PR snapshot and preparing advisory analysis…"
            : view.run.request?.prUrl
              ? "No completed analysis is available for this run."
              : "This run was started without a pull request."}
        </p>
      ) : (
        <>
          <a
            className="pr-link"
            href={record.pr.url}
            target="_blank"
            rel="noreferrer"
          >
            {record.pr.title}
            <ArrowUpRightIcon size={16} />
          </a>
          <p className="analysis-meta">
            {record.pr.repository} · PR #{record.pr.number} ·{" "}
            <Id value={record.pr.commitSha} />
          </p>
          {record.status !== "complete" ? (
            <p className={record.status === "failed" ? "error" : "notice"}>
              {record.error ?? "Analysis is being prepared…"}
            </p>
          ) : (
            record.analysis && (
              <>
                <div className="risk-line">
                  <span className={`risk risk-${record.analysis.riskLevel}`}>
                    {record.analysis.riskLevel} estimated risk
                  </span>
                  <span className="muted">Llama 3.3</span>
                </div>
                <p>{record.analysis.summary}</p>
                <h3>Affected areas</h3>
                <ul>
                  {record.analysis.affectedAreas.map((area) => (
                    <li key={area}>{area}</li>
                  ))}
                </ul>
                <h3>Potential failure modes</h3>
                {record.analysis.likelyFailureModes.length ? (
                  <ul>
                    {record.analysis.likelyFailureModes.map((mode) => (
                      <li key={mode}>{mode}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">None suggested.</p>
                )}
                <h3>Suggested checks</h3>
                <ul className="check-list">
                  {record.analysis.suggestedChecks.map((check) => (
                    <li key={check}>
                      <span>{CHECK_CATALOG[check]}</span>
                    </li>
                  ))}
                </ul>
                <p className="field-help">
                  Suggestions are not test results. AI does not decide promotion
                  or rollback. Version-to-commit association is operator
                  supplied.
                </p>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
function RunDetail({
  view,
  live,
  admin,
  fresh,
  now,
  pending,
  onAction
}: {
  view: RunView;
  live: boolean;
  admin: boolean;
  fresh: boolean;
  now: number;
  pending: boolean;
  onAction: (action: string, body: object) => Promise<void>;
}) {
  const run = view.run;
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    setConfirm(null);
  }, [run.id, run.phase, run.approval?.id]);
  const canApprove =
    live &&
    fresh &&
    view.allowedActions.approve &&
    Boolean(
      run.approval &&
      run.approval.expiresAt > now &&
      (view.deadlines.canary ?? 0) > now
    );
  const canRollback = live && fresh && view.allowedActions.rollback;
  const canReconcile = live && fresh && view.allowedActions.reconcile;
  const enabled =
    confirm === "approve"
      ? canApprove
      : confirm === "rollback"
        ? canRollback
        : canReconcile;
  const deadline =
    run.phase === "verifying_rollback"
      ? view.deadlines.rollback
      : run.phase === "verifying_promotion"
        ? view.deadlines.postPromotion
        : run.phase === "awaiting_approval"
          ? Math.min(
              view.deadlines.approval ?? Infinity,
              view.deadlines.canary ?? Infinity
            )
          : run.phase === "canary"
            ? view.deadlines.canary
            : null;
  return (
    <>
      <div className="run-heading">
        <div>
          <span className="run-context">
            {live ? "Current run" : "Historical run"} · <Id value={run.id} />
          </span>
          <h1>{view.analysis?.pr.title ?? prLabel(run)}</h1>
          <p className="muted">Started {date(run.createdAt)}</p>
        </div>
        <Status run={run} />
      </div>
      <section
        className={`outcome outcome-${run.phase}`}
        aria-label="Deployment state"
      >
        <div>
          <h2>
            {run.phase === "verifying_rollback"
              ? "Stable allocation confirmed. Verifying traffic."
              : phases[run.phase]}
          </h2>
          <p>{run.reason}</p>
          {deadline && !terminal(run) && (
            <p className="deadline">
              {Math.max(0, Math.ceil((deadline - now) / 1000))}s until
              verification or safety deadline
            </p>
          )}
          {run.failure && <p className="error">{run.failure.message}</p>}
        </div>
        {live && !terminal(run) && (
          <span className="lock-label">Target locked</span>
        )}
      </section>
      <div className="version-strip">
        <div>
          <span className="muted">Stable version</span>
          <strong>
            <span className="version-dot stable" />
            <Id value={run.stable} />
          </strong>
        </div>
        <div>
          <span className="muted">Candidate version</span>
          <strong>
            <span className="version-dot candidate" />
            <Id value={run.candidate} />
          </strong>
        </div>
        <div>
          <span className="muted">Last confirmed allocation</span>
          <strong>
            {run.expected
              ? run.expected.versions
                  .map(
                    (v) =>
                      `${v.version_id === run.candidate ? "Candidate" : "Stable"} ${v.percentage}%`
                  )
                  .join(" / ")
              : "Awaiting validation"}
          </strong>
        </div>
      </div>
      <p className="allocation-note">
        {live
          ? "Persisted controller confirmation; not an independent live Cloudflare query."
          : "Allocation at this run’s last confirmation; it may have changed in later runs."}
      </p>
      {admin && live && !terminal(run) && (
        <section className="actions-section" aria-label="Deployment controls">
          {!fresh && (
            <p className="error">
              State is stale or unavailable. Controls are disabled until a
              successful refresh.
            </p>
          )}
          <div className="action-buttons">
            {run.phase === "awaiting_approval" && (
              <button
                className="button primary"
                disabled={!canApprove || pending}
                onClick={() => setConfirm("approve")}
              >
                Approve promotion
                <ArrowUpRightIcon size={16} />
              </button>
            )}
            {view.allowedActions.rollback && (
              <button
                className="button danger"
                disabled={!canRollback || pending}
                onClick={() => setConfirm("rollback")}
              >
                Restore stable
              </button>
            )}
            {view.allowedActions.reconcile && (
              <button
                className="button secondary"
                disabled={!canReconcile || pending}
                onClick={() => setConfirm("reconcile")}
              >
                Reconcile deployment
              </button>
            )}
            {run.phase === "verifying_rollback" && (
              <p className="muted">
                Checking ordinary traffic. No further deployment writes are
                needed.
              </p>
            )}
          </div>
          {confirm && (
            <div className="confirmation">
              <h3>
                {confirm === "approve"
                  ? "Promote this candidate to 100%?"
                  : confirm === "rollback"
                    ? "Restore the stable version?"
                    : "Recheck Cloudflare state?"}
              </h3>
              <p>
                {confirm === "approve"
                  ? `Candidate ${run.candidate} will receive all traffic, followed by health verification.`
                  : confirm === "rollback"
                    ? `Stable ${run.stable} will be restored. The lock stays held until traffic recovery is verified.`
                    : "Reconciliation reads actual state. Confirmed stable allocation begins a new traffic check; a recovered pending mutation may trigger stable restoration."}
              </p>
              <div className="action-buttons">
                <button
                  className="button primary"
                  disabled={!enabled || pending}
                  onClick={async () => {
                    await onAction(confirm, {
                      runId: run.id,
                      ...(confirm === "approve"
                        ? { approvalId: run.approval?.id }
                        : {})
                    });
                    setConfirm(null);
                  }}
                >
                  {pending ? "Submitting…" : "Confirm"}
                </button>
                <button
                  className="button secondary"
                  disabled={pending}
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      <Health view={view} now={now} live={live} />
      <div className="detail-columns">
        <Analysis view={view} />
        <section className="section timeline">
          <h2>Run timeline</h2>
          <ol>
            {run.events.map((event, i) => (
              <li key={`${event.at}-${i}`}>
                <span className="timeline-dot" />
                <div>
                  <strong>{phases[event.phase]}</strong>
                  <time dateTime={new Date(event.at).toISOString()}>
                    {new Date(event.at).toLocaleTimeString()}
                  </time>
                  <p>{event.reason}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}

function Dashboard({
  admin,
  onSignOut,
  onSignIn
}: {
  admin: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
}) {
  const [rehearsal, setRehearsal] = useState<RehearsalState | null>(null);
  const [rehearsalConfirm, setRehearsalConfirm] = useState(false);
  const initialSelection = useRef(false);
  const [history, setHistory] = useState<Run[]>([]);
  const [current, setCurrent] = useState<RunView | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastSync, setLastSync] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [newRun, setNewRun] = useState(false);
  const [chat, setChat] = useState(false);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const selection = useRef<string | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const version = ++generation.current;
    try {
      const [state, runs, preset] = await Promise.all([
        api<RunView | null>(
          "/api/deployment/state",
          undefined,
          "GET",
          abort.signal
        ),
        api<Run[]>("/api/deployment/history", undefined, "GET", abort.signal),
        api<RehearsalState>(
          "/api/demo/rehearsal",
          undefined,
          "GET",
          abort.signal
        )
      ]);
      if (!admin && !initialSelection.current && !selection.current) {
        selection.current =
          runs.find((r) => r.phase === "promoted" && r.source)?.id ?? null;
        setSelected(selection.current);
      }
      initialSelection.current = true;
      const id = selection.current;
      const detail =
        id && id !== state?.run.id
          ? await api<RunView>(
              `/api/deployment/${id}`,
              undefined,
              "GET",
              abort.signal
            )
          : state;
      if (generation.current !== version) return;
      setCurrent(state);
      setRehearsal(preset);
      setHistory(runs);
      setView(detail);
      setLastSync(Date.now());
      setLoaded(true);
      setError("");
    } catch (error) {
      if (abort.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        onSignOut();
        return;
      }
      setError((error as Error).message);
      setLoaded(true);
    }
  }, [onSignOut, admin]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!disposed) timer = setTimeout(poll, 5000);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (chat && window.innerWidth <= 1200)
      document
        .querySelector(".chat-sidebar")
        ?.scrollIntoView({ block: "start" });
  }, [chat]);
  const select = (id: string | null) => {
    selection.current = id;
    setSelected(id);
    setView(null);
    setNotice("");
    void refresh();
  };
  const fresh = !error && now - lastSync < 15_000;
  const locked = Boolean(current && !terminal(current.run));
  const action = async (action: string, body: object) => {
    if (!admin) {
      setNotice("Admin sign-in is required for deployment controls.");
      return;
    }
    setPending(true);
    setNotice("");
    try {
      await api(`/api/deployment/${action}`, body);
      setNotice("Request accepted. Watch the run for the confirmed outcome.");
    } catch (error) {
      setNotice(
        `${(error as Error).message} State has been refreshed; acceptance is not proof of completion.`
      );
    } finally {
      await refresh();
      setPending(false);
    }
  };
  const filtered = history.filter((run) =>
    `${run.id} ${run.candidate} ${prLabel(run)} ${phases[run.phase]}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  return (
    <>
      <header className="topbar">
        <a href="/" className="brand">
          <ShieldCheckIcon size={27} weight="duotone" />
          DeployGuard
        </a>
        <span className="target-name">deployguard-demo-target</span>
        <div className="top-actions">
          <button
            className={`button quiet ${chat ? "active" : ""}`}
            onClick={() => setChat(!chat)}
            aria-expanded={chat}
          >
            <ChatCircleDotsIcon size={19} />
            Ask DeployGuard
          </button>
          {!admin && (
            <button className="button secondary" onClick={onSignIn}>
              Admin sign in
            </button>
          )}
          {admin && (
            <button
              className="button quiet icon-button"
              aria-label="Sign out"
              title="Sign out"
              onClick={async () => {
                try {
                  await api("/api/session", undefined, "DELETE");
                  onSignOut();
                } catch (error) {
                  setNotice(
                    `Could not sign out: ${(error as Error).message}. Retry sign out.`
                  );
                }
              }}
            >
              <SignOutIcon size={19} />
            </button>
          )}
        </div>
      </header>
      <div className="page-heading">
        <div>
          <h2>Deployments</h2>
          <p className="muted">
            Progressive delivery with deterministic safety.
          </p>
        </div>
        <div className="page-tools">
          <span className={`sync ${fresh ? "synced" : ""}`}>
            {lastSync
              ? `Updated ${Math.max(0, Math.floor((now - lastSync) / 1000))}s ago`
              : "Connecting…"}
          </span>
          <button
            className="button secondary icon-button"
            title="Refresh deployment state"
            aria-label="Refresh deployment state"
            onClick={() => void refresh()}
          >
            <ArrowClockwiseIcon size={18} />
          </button>
          {!admin && <span className="demo-label">Reviewer mode</span>}
          {admin && (
            <button
              className="button primary"
              disabled={!loaded || !fresh || locked}
              onClick={() => setNewRun(!newRun)}
              aria-expanded={newRun}
            >
              {newRun ? <XIcon size={17} /> : <PlusIcon size={17} />}New
              deployment
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="page-alert error" role="alert">
          Could not refresh deployment state: {error}{" "}
          <button className="text-button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      <section className="demo-guide" aria-label="Ready-made demo options">
        <div>
          <h2>Explore DeployGuard</h2>
          <p className="muted">
            Real deployment evidence, ready to review. No PR setup or Worker
            upload needed.
          </p>
        </div>
        <div className="demo-options">
          <button
            className="demo-option"
            disabled={!history.some((r) => r.phase === "promoted" && r.source)}
            onClick={() =>
              select(
                history.find((r) => r.phase === "promoted" && r.source)!.id
              )
            }
          >
            <strong>
              Review a successful deployment
              <ArrowUpRightIcon size={16} />
            </strong>
            <span>
              PR #1, AI recommendations, healthy canary and full promotion.
            </span>
          </button>
          <button
            className="demo-option"
            disabled={
              !history.some(
                (r) => r.phase === "rolled_back" && r.rollbackVerification
              )
            }
            onClick={() =>
              select(
                history.find(
                  (r) => r.phase === "rolled_back" && r.rollbackVerification
                )!.id
              )
            }
          >
            <strong>
              Review a failed canary
              <ArrowUpRightIcon size={16} />
            </strong>
            <span>
              See the health failure, automatic rollback and verified recovery.
            </span>
          </button>
          <button
            className="demo-option"
            disabled={
              !fresh ||
              locked ||
              pending ||
              !rehearsal ||
              now < rehearsal.availableAt
            }
            onClick={() => setRehearsalConfirm(!rehearsalConfirm)}
            aria-expanded={rehearsalConfirm}
          >
            <strong>
              Run rollback rehearsal
              <ArrowUpRightIcon size={16} />
            </strong>
            <span>
              {locked
                ? "A run is active. Review its progress below."
                : rehearsal && now < rehearsal.availableAt
                  ? `Ready again in ${Math.ceil((rehearsal.availableAt - now) / 1000)}s. Stored results remain available.`
                  : "Launch the prepared failing version on the disposable target and watch it recover."}
            </span>
          </button>
        </div>
        {rehearsalConfirm && (
          <div className="confirmation">
            <h3>Start a real rollback rehearsal?</h3>
            <p>
              The prepared candidate will briefly receive 10% of traffic on the
              disposable demo Worker. It intentionally fails its health check.
              DeployGuard will restore the healthy version and verify recovery.
              No approval is needed for this fixed rehearsal.
            </p>
            <p className="field-help">
              This is a real deployment, not a simulation. One run at a time;
              five minutes between rehearsal starts.
            </p>
            <div className="action-buttons">
              <button
                className="button primary"
                disabled={
                  !fresh ||
                  locked ||
                  pending ||
                  !rehearsal ||
                  now < rehearsal.availableAt
                }
                onClick={async () => {
                  setPending(true);
                  setNotice("");
                  try {
                    await api("/api/reviewer-session", {});
                    const run = await api<Run>("/api/demo/rehearsal", {});
                    selection.current = run.id;
                    setSelected(run.id);
                    setRehearsalConfirm(false);
                    setNotice(
                      "Rehearsal started. The backend runs the safety checks and recovery automatically."
                    );
                  } catch (error) {
                    setNotice(
                      `${(error as Error).message} Refresh state before retrying.`
                    );
                  } finally {
                    await refresh();
                    setPending(false);
                  }
                }}
              >
                {pending ? "Starting…" : "Start prepared rehearsal"}
              </button>
              <button
                className="button secondary"
                disabled={pending}
                onClick={() => setRehearsalConfirm(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {!admin && (
          <p className="demo-access-note">
            Reviewer access includes stored evidence, chat and the fixed
            rehearsal. Custom deployments and manual controls require admin
            sign-in.
          </p>
        )}
      </section>
      {admin && newRun && (
        <div className="new-run-container">
          <NewRun
            locked={locked || !fresh}
            onCreated={(run) => {
              selection.current = run.id;
              setSelected(run.id);
              setNewRun(false);
              void refresh();
            }}
          />
        </div>
      )}
      <div className={`workspace ${chat ? "with-chat" : ""}`}>
        <aside className="history">
          <div className="section-heading">
            <h2>History</h2>
            <span className="muted">{history.length}</span>
          </div>
          <label className="sr-only" htmlFor="history-search">
            Filter deployment history
          </label>
          <input
            id="history-search"
            className="history-search"
            type="search"
            placeholder="Find a run, PR or version…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {current && (
            <button className="current-link" onClick={() => select(null)}>
              <ArrowLeftIcon size={14} />
              Current run
              <Status run={current.run} />
            </button>
          )}
          <nav aria-label="Deployment history">
            {filtered.map((run) => (
              <button
                key={run.id}
                className={`history-row ${view?.run.id === run.id ? "selected" : ""}`}
                aria-current={view?.run.id === run.id ? "true" : undefined}
                onClick={() => select(run.id)}
              >
                <div>
                  <strong>{prLabel(run)}</strong>
                  <time>
                    {new Date(run.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric"
                    })}
                  </time>
                </div>
                <Status run={run} />
                <span className="history-id">
                  <Id value={run.candidate} />
                  <span>
                    {new Date(run.createdAt).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </span>
                </span>
              </button>
            ))}
          </nav>
          {loaded && !filtered.length && (
            <p className="empty-inline">
              {query
                ? "No matching deployments."
                : "Your deployment history will appear here."}
            </p>
          )}
          <p className="history-foot">
            Up to 100 stored runs
            <br />
            One account · one target
          </p>
        </aside>
        <main className="run-detail" id="main-content">
          {notice && (
            <p className="notice" aria-live="polite">
              {notice}
            </p>
          )}
          {view ? (
            <RunDetail
              key={view.run.id}
              view={view}
              live={view.run.id === current?.run.id}
              admin={admin}
              fresh={fresh}
              now={now}
              pending={pending}
              onAction={action}
            />
          ) : !loaded || selected ? (
            <div className="empty-state" aria-live="polite">
              <h1>{error ? "Run unavailable" : "Loading deployment…"}</h1>
              <p>
                {error
                  ? "Refresh to retry loading the selected record."
                  : "Reading stored state and health evidence."}
              </p>
            </div>
          ) : (
            <div className="empty-state">
              <ShieldCheckIcon size={40} />
              <h1>Your first deployment starts here.</h1>
              <p>
                Upload a candidate Worker version, then start validation.
                DeployGuard checks health before asking you to promote.
              </p>
              {admin && (
                <button
                  className="button primary"
                  disabled={!fresh}
                  onClick={() => setNewRun(true)}
                >
                  New deployment
                  <PlusIcon size={16} />
                </button>
              )}
            </div>
          )}
        </main>
        {chat && (
          <aside className="chat-sidebar">
            <div className="chat-close">
              <button
                className="button quiet icon-button"
                aria-label="Close deployment chat"
                onClick={() => setChat(false)}
              >
                <XIcon size={18} />
              </button>
            </div>
            <Suspense fallback={<p className="muted">Loading chat…</p>}>
              <DeploymentChat runId={view?.run.id} admin={admin} />
            </Suspense>
          </aside>
        )}
      </div>
    </>
  );
}
export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const signedOut = useCallback(() => setAuthenticated(false), []);
  useEffect(() => {
    api<{ authenticated: boolean }>("/api/session")
      .then((data) => setAuthenticated(data.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);
  if (signIn)
    return (
      <>
        <button
          className="button quiet back-to-demo"
          onClick={() => setSignIn(false)}
        >
          <ArrowLeftIcon size={16} />
          Back to reviewer demo
        </button>
        <SignIn
          onSignIn={() => {
            setAuthenticated(true);
            setSignIn(false);
          }}
        />
      </>
    );
  return (
    <Dashboard
      key={authenticated ? "admin" : "reviewer"}
      admin={authenticated}
      onSignOut={signedOut}
      onSignIn={() => setSignIn(true)}
    />
  );
}
