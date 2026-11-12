"use client";

/**
 * Shared presentational pieces for every vault deposit / withdraw screen.
 *
 * The Morpho "Deposit USDG" amount screen is the source of truth for layout, spacing and
 * typography. Protocol containers (Rhea, Kamino, Morpho, the launch/wrapper amount screen) keep
 * their own hooks, data fetching, review/sign logic and business rules; they only render these
 * primitives, so there is exactly ONE visual implementation of the back link, title + subtitle +
 * risk pill, amount card + Max, summary box, disclaimer, primary button and next-step line.
 */

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Icon } from "@/lib/icons";
import { RiskChip } from "@/components/ui/risk-chip";
import type { VaultFlowSummaryRow, VaultFlowTone } from "@/lib/vault/vaultFlow";
import "@/components/screens/vault.css";

const MUTED = "var(--muted-foreground)";

function toneColor(tone: VaultFlowTone | undefined): string | undefined {
  if (tone === "caution") return "var(--caution)";
  if (tone === "gain") return "var(--gain)";
  return undefined;
}

export interface VaultFlowPageProps {
  readonly backHref: string;
  readonly title: string;
  readonly subtitle: string;
  readonly riskTier?: number;
  readonly testId?: string;
  /** The amount card contents; pass null/undefined to hide the card during review. */
  readonly children?: ReactNode;
  /** Extra cards below the amount card (review, position, receipts). */
  readonly footer?: ReactNode;
}

/** Back link + page head (H1, subtitle, risk pill) + the main amount card. */
export function VaultFlowPage({
  backHref,
  title,
  subtitle,
  riskTier = 1,
  testId,
  children,
  footer,
}: VaultFlowPageProps) {
  return (
    <div className="page page-narrow" data-testid={testId}>
      <Link
        className="qlink"
        style={{ display: "inline-flex", marginBottom: 14 }}
        href={backHref}
        data-testid="vault-flow-back"
      >
        <Icon name="chevr" size={15} /> Back to vault
      </Link>
      <div className="pagehead">
        <div>
          <h1 data-testid="vault-flow-title">{title}</h1>
          <div className="sub" data-testid="vault-flow-subtitle">
            {subtitle}
          </div>
        </div>
        <RiskChip tier={riskTier} />
      </div>
      {children != null && (
        <div className="card card-pad" data-testid="vault-flow-card">
          {children}
        </div>
      )}
      {footer}
    </div>
  );
}

export interface AmountFieldProps {
  readonly id: string;
  readonly label: string;
  readonly assetSymbol: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onMax?: () => void;
  readonly maxDisabled?: boolean;
  readonly disabled?: boolean;
  readonly helper?: ReactNode;
  readonly helperTone?: "muted" | "caution";
  readonly extra?: ReactNode;
}

/** The amount card: label, big input, asset label, Max button and the helper line. */
export function AmountField({
  id,
  label,
  assetSymbol,
  value,
  onChange,
  onMax,
  maxDisabled = false,
  disabled = false,
  helper,
  helperTone = "muted",
  extra,
}: AmountFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="field" style={{ marginBottom: 16 }} data-testid="vault-flow-amount">
      <label htmlFor={id}>{label}</label>
      <div className={"amtbox" + (focused ? " focus" : "")} id={`${id}-box`}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            className="input big"
            id={id}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.00"
            style={{ border: "none", boxShadow: "none", padding: 0, background: "none" }}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <span style={{ fontSize: 18, fontWeight: 600, color: MUTED }}>{assetSymbol}</span>
          {onMax && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              data-testid="vault-flow-max"
              disabled={disabled || maxDisabled}
              onClick={onMax}
            >
              Max
            </button>
          )}
        </div>
      </div>
      {helper !== undefined && (
        <div
          className="hint"
          style={helperTone === "caution" ? { color: "var(--caution)" } : undefined}
          data-testid="vault-flow-helper"
        >
          {helper}
        </div>
      )}
      {extra}
    </div>
  );
}

export interface SummaryBoxProps {
  readonly rows: readonly VaultFlowSummaryRow[];
  readonly testId?: string;
  readonly pending?: boolean;
}

/** The summary box — every protocol's rows render in this one style. */
export function SummaryBox({ rows, testId = "vault-flow-summary", pending = false }: SummaryBoxProps) {
  return (
    <div
      data-testid={testId}
      aria-busy={pending || undefined}
      style={{
        background: "var(--background)",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--radius)",
        padding: 14,
        marginBottom: 8,
      }}
    >
      {rows.map((row) => (
        <div className="preview-row" key={row.key} data-testid={`vault-flow-row-${row.key}`}>
          <span className="muted">{row.label}</span>
          <span className="tnum" style={{ color: toneColor(row.tone), fontWeight: row.tone ? 500 : undefined }}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function FlowNotice({
  children,
  tone = "info",
  testId,
}: {
  children: ReactNode;
  tone?: VaultFlowTone;
  testId?: string;
}) {
  const color = tone === "caution" ? "var(--caution)" : tone === "gain" ? "var(--gain)" : "var(--info)";
  return (
    <div
      data-testid={testId}
      style={{
        marginTop: 10,
        fontSize: 12,
        lineHeight: 1.5,
        color,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 26%, transparent)`,
        borderRadius: 10,
        padding: "8px 10px",
      }}
    >
      {children}
    </div>
  );
}

export function FlowDisclaimer({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="vault-flow-disclaimer"
      style={{ fontSize: 12, color: MUTED, lineHeight: 1.5, marginBottom: 16 }}
    >
      {children}
    </div>
  );
}

export interface FlowPrimaryProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly testId?: string;
}

export function FlowPrimary({ children, onClick, disabled = false, testId = "vault-flow-primary" }: FlowPrimaryProps) {
  return (
    <button
      type="button"
      className="btn btn-primary btn-lg"
      style={{ width: "100%" }}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function FlowNextStep({ children }: { children?: ReactNode }) {
  return (
    <div
      data-testid="vault-flow-next"
      style={{ textAlign: "center", fontSize: 11, color: MUTED, marginTop: 10 }}
    >
      {children}
    </div>
  );
}

/** A small deposit/withdraw segmented switch, kept in the shared visual language. */
export function FlowModeToggle({
  mode,
  onChange,
  disabled = false,
  testId = "vault-flow-mode",
}: {
  mode: "deposit" | "withdraw";
  onChange: (mode: "deposit" | "withdraw") => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 12 }} data-testid={testId}>
      {(["deposit", "withdraw"] as const).map((option) => (
        <button
          key={option}
          type="button"
          className={`pill${mode === option ? "" : " ghosty"}`}
          aria-pressed={mode === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          style={{ cursor: disabled ? "not-allowed" : "pointer", textTransform: "capitalize" }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** Secondary card used for review/position/receipt blocks below the amount card. */
export function FlowCard({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="card card-pad" data-testid={testId} style={{ marginTop: 14 }}>
      {children}
    </div>
  );
}

export function FlowSectionTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{children}</div>;
}
