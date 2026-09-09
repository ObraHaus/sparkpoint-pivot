"use client";

/**
 * NavTree — renders a `NavNode[]` (leaves + collapsible groups) for BOTH nav surfaces that show the
 * secondary nav: the desktop rail and the mobile More sheet. One renderer means the two can't drift.
 *
 * A group is a presentation affordance only. Collapsing it never removes a route from the app: the
 * ⌘K palette flattens the same tree, and the exit path is pinned outside the tree entirely (N2).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/lib/icons";
import { isNavGroup, resolveGroupOpen, toHref, type NavItem, type NavNode } from "@/lib/nav";
import { useNavGroups } from "@/lib/ui/useNavGroups";

interface NavTreeProps {
  nodes: readonly NavNode[];
  /** The active base route segment (see `baseSegment`). */
  active: string;
  /** Called after any nav link is followed — the mobile sheet uses it to close itself. */
  onNavigate?: () => void;
  /** Optional trailing badge per route (the rail's Outcome Log count). */
  renderBadge?: (route: string) => ReactNode;
}

export function NavTree({ nodes, active, onNavigate, renderBadge }: NavTreeProps) {
  const { state, setGroupOpen } = useNavGroups();

  return (
    <>
      {nodes.map((node) => {
        if (!isNavGroup(node)) {
          return <NavLeaf key={node.route} item={node} active={active} onNavigate={onNavigate} renderBadge={renderBadge} />;
        }
        const open = resolveGroupOpen(state, node, active);
        const holdsActive = node.children.some((c) => c.route === active);
        return (
          <div className="navgroup" key={node.key}>
            <button
              type="button"
              className={"navlink navgroup-btn" + (holdsActive && !open ? " active" : "")}
              aria-expanded={open}
              aria-controls={`navgroup-${node.key}`}
              onClick={() => setGroupOpen(node.key, !open)}
            >
              <Icon name={node.icon} size={18} />
              {node.label}
              <span className={"navgroup-chev" + (open ? " open" : "")} aria-hidden="true">
                <Icon name="chevd" size={15} />
              </span>
            </button>
            {open && (
              <div className="navgroup-items" id={`navgroup-${node.key}`}>
                {node.children.map((child) => (
                  <NavLeaf key={child.route} item={child} active={active} onNavigate={onNavigate} renderBadge={renderBadge} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function NavLeaf({
  item,
  active,
  onNavigate,
  renderBadge,
}: {
  item: NavItem;
  active: string;
  onNavigate?: () => void;
  renderBadge?: (route: string) => ReactNode;
}) {
  return (
    <Link
      href={toHref(item.route)}
      className={"navlink" + (active === item.route ? " active" : "")}
      onClick={onNavigate}
    >
      <Icon name={item.icon} size={18} />
      {item.label}
      {renderBadge?.(item.route)}
    </Link>
  );
}
