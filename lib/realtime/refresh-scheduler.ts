"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useTransition } from "react";

/**
 * Page-wide coordinator for `router.refresh()`. Realtime events from every subscriber on the page
 * funnel into one debounced refresh; at most one refresh is in flight, events arriving while one is
 * pending (or during a suspension window) are dropped.
 */

const DEBOUNCE_MS = 600;
const MAX_WAIT_MS = 2000;
/** Safety net in case the driver that started a refresh never observes it settle. */
const IN_FLIGHT_TIMEOUT_MS = 10_000;

interface Driver {
  id: string;
  run: () => void;
}

const drivers: Driver[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let firstRequestAt = 0;
let lastSettledAt = 0;
let suspendedUntil = 0;
let inFlight: { driverId: string; timeout: ReturnType<typeof setTimeout> } | null = null;
let explicitQueued = false;

function cancelDebounce() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
}

function start(): boolean {
  const driver = drivers[drivers.length - 1];
  if (!driver || inFlight) return false;
  inFlight = {
    driverId: driver.id,
    timeout: setTimeout(() => settle(driver.id), IN_FLIGHT_TIMEOUT_MS),
  };
  driver.run();
  return true;
}

function settle(driverId: string) {
  if (!inFlight || inFlight.driverId !== driverId) return;
  clearTimeout(inFlight.timeout);
  inFlight = null;
  lastSettledAt = Date.now();
  if (explicitQueued) {
    explicitQueued = false;
    start();
  }
}

/** Ask for a refresh because data changed in the background (realtime). Coalesced and droppable. */
export function requestRealtimeRefresh() {
  const now = Date.now();
  if (inFlight || now < suspendedUntil) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  else firstRequestAt = now;
  const wait = Math.max(
    Math.min(DEBOUNCE_MS, firstRequestAt + MAX_WAIT_MS - now),
    lastSettledAt + DEBOUNCE_MS - now,
    0,
  );
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (Date.now() < suspendedUntil) return;
    start();
  }, wait);
}

/** Drop realtime-triggered refreshes for the next `ms` milliseconds (e.g. during a bulk mutation). */
export function suspendRealtimeRefresh(ms: number) {
  suspendedUntil = Math.max(suspendedUntil, Date.now() + ms);
  cancelDebounce();
}

/** Refresh right away after a user-initiated mutation; queued behind any refresh already in flight. */
export function refreshNow() {
  cancelDebounce();
  if (!start()) explicitQueued = drivers.length > 0;
}

/**
 * Registers this component's router as a refresh driver and returns the scheduler controls. Safe to
 * call from any number of components; they all share one queue.
 */
export function useRefreshScheduler() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const id = useId();

  useEffect(() => {
    const driver: Driver = { id, run: () => startTransition(() => router.refresh()) };
    drivers.push(driver);
    return () => {
      const index = drivers.indexOf(driver);
      if (index >= 0) drivers.splice(index, 1);
      settle(id);
    };
  }, [id, router]);

  useEffect(() => {
    if (!isPending) settle(id);
  }, [id, isPending]);

  return useMemo(
    () => ({ requestRealtimeRefresh, suspendRealtimeRefresh, refreshNow }),
    [],
  );
}
