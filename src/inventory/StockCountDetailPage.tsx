import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { isAbortError, isApiClientError } from '../api/errors.ts';
import { catalogApi, type CatalogApi } from '../catalog/catalogApi.ts';
import { buildCategoryOptions } from '../catalog/categoryUtils.ts';
import type { Category } from '../catalog/types.ts';
import { formatShopTimestamp } from '../utils/shopDate.ts';
import { BarcodeScannerPanel } from './components/BarcodeScannerPanel.tsx';
import { inventoryApi, type InventoryApi } from './inventoryApi.ts';
import { recordSessionStockCount } from './sessionStockCounts.ts';
import {
  computeLineDiscrepancy,
  doesLineHaveStaleStockVersion,
  formatSignedDelta,
  getLineExpectedQuantity,
  parseChangedStockSkus,
  parseCountQuantityInput,
} from './stockCountUtils.ts';
import type {
  PostStockCountResponse,
  StockCountAdjustmentSummary,
  StockCountDetail,
  StockCountLineDetail,
} from './types.ts';
import '../catalog/ProductsPage.css';
import './Inventory.css';

export interface StockCountDetailPageProps {
  api?: InventoryApi;
  catalog?: CatalogApi;
}

type LineFilterMode = 'ALL' | 'PENDING' | 'DISCREPANCIES' | 'MATCHED' | 'RECOUNT';

interface LineConflictNotice {
  serverCountedQuantity: number | null;
  serverReason: string | null;
}

interface SkuCountDraft {
  countedRaw: string;
  reasonRaw: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  recountRequired: boolean;
  conflictNotice: LineConflictNotice | null;
}

function buildInitialDrafts(detail: StockCountDetail): Record<string, SkuCountDraft> {
  const drafts: Record<string, SkuCountDraft> = {};
  for (const line of detail.lines) {
    drafts[line.skuId] = {
      countedRaw: line.countedQuantity === null ? '' : String(line.countedQuantity),
      reasonRaw: line.reason ?? '',
      dirty: false,
      saving: false,
      error: null,
      recountRequired: detail.status === 'DRAFT' && doesLineHaveStaleStockVersion(line),
      conflictNotice: null,
    };
  }
  return drafts;
}

function mergeReloadedDrafts(
  freshDetail: StockCountDetail,
  prevDrafts: Record<string, SkuCountDraft>,
  preserveDirtyEdits: boolean,
): Record<string, SkuCountDraft> {
  const next: Record<string, SkuCountDraft> = {};
  for (const line of freshDetail.lines) {
    const prev = prevDrafts[line.skuId];
    const staleStock =
      freshDetail.status === 'DRAFT' && doesLineHaveStaleStockVersion(line);

    if (
      preserveDirtyEdits &&
      freshDetail.status === 'DRAFT' &&
      prev &&
      (prev.dirty || prev.error !== null || prev.conflictNotice !== null)
    ) {
      const serverQtyRaw = line.countedQuantity === null ? '' : String(line.countedQuantity);
      const serverReasonRaw = line.reason ?? '';
      const differsFromServer =
        prev.countedRaw !== serverQtyRaw || prev.reasonRaw !== serverReasonRaw;
      next[line.skuId] = {
        ...prev,
        saving: false,
        recountRequired: prev.recountRequired || staleStock,
        conflictNotice: differsFromServer
          ? {
              serverCountedQuantity: line.countedQuantity,
              serverReason: line.reason,
            }
          : prev.conflictNotice,
      };
    } else {
      next[line.skuId] = {
        countedRaw: line.countedQuantity === null ? '' : String(line.countedQuantity),
        reasonRaw: line.reason ?? '',
        dirty: false,
        saving: false,
        error: null,
        recountRequired: staleStock,
        conflictNotice: null,
      };
    }
  }
  return next;
}

function buildDefaultAdjustmentsFromPostedDetail(
  detail: StockCountDetail,
): StockCountAdjustmentSummary[] {
  return detail.lines.map((line) => {
    const expected = getLineExpectedQuantity(line);
    const counted = line.countedQuantity ?? expected;
    const delta = counted - expected;
    return {
      skuId: line.skuId,
      skuCode: line.skuCode,
      productName: line.productName,
      size: line.size,
      expectedQuantity: expected,
      countedQuantity: counted,
      quantityDelta: delta,
      reason: line.reason,
      allocationBasis: delta < 0 ? 'FIFO_SHORTAGE' : delta > 0 ? 'AUDIT_SURPLUS' : null,
      batchIds: [],
    };
  });
}

export function StockCountDetailPage({
  api = inventoryApi,
  catalog = catalogApi,
}: StockCountDetailPageProps) {
  const { countId = '' } = useParams();
  const tableHeadingId = useId();
  const filterSearchId = useId();

  const [detail, setDetail] = useState<StockCountDetail | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SkuCountDraft>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{
    message: string;
    requestId?: string | null;
    notFound?: boolean;
  } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [filterQuery, setFilterQuery] = useState('');
  const [filterMode, setFilterMode] = useState<LineFilterMode>('ALL');

  const [isLookingUpScan, setIsLookingUpScan] = useState(false);
  const [scanError, setScanError] = useState<{
    message: string;
    requestId?: string | null;
  } | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [lastScannedSkuId, setLastScannedSkuId] = useState<string | null>(null);

  const [globalNotice, setGlobalNotice] = useState<{
    tone: 'info' | 'warning' | 'error';
    message: string;
    requestId?: string | null;
  } | null>(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<{
    message: string;
    requestId?: string | null;
    retryable?: boolean;
  } | null>(null);
  const [postResult, setPostResult] = useState<PostStockCountResponse | null>(null);

  const detailRef = useRef<StockCountDetail | null>(null);
  const draftsRef = useRef<Record<string, SkuCountDraft>>({});
  const versionRef = useRef<number>(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const postAttemptRef = useRef<{ expectedVersion: number; idempotencyKey: string } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commitDetailAndDrafts = useCallback(
    (nextDetail: StockCountDetail, nextDrafts: Record<string, SkuCountDraft>) => {
      detailRef.current = nextDetail;
      draftsRef.current = nextDrafts;
      versionRef.current = nextDetail.version;
      setDetail(nextDetail);
      setDrafts(nextDrafts);
    },
    [],
  );

  const commitDrafts = useCallback((nextDrafts: Record<string, SkuCountDraft>) => {
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
  }, []);

  const categoryLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of buildCategoryOptions(categories)) {
      map.set(option.categoryId, option.label);
    }
    return map;
  }, [categories]);

  const scopeLabel = useMemo(() => {
    if (!detail) {
      return 'Stock Count';
    }
    if (detail.scope === 'SHOP') {
      return 'Whole Shop';
    }
    if (detail.categoryId) {
      return categoryLabelMap.get(detail.categoryId) || `Category (${detail.categoryId})`;
    }
    return 'Selected Category';
  }, [categoryLabelMap, detail]);

  useEffect(() => {
    document.title = detail ? `${scopeLabel} Stock Count | Bagade Clothing` : 'Stock Count | Bagade Clothing';
  }, [detail, scopeLabel]);

  useEffect(() => {
    if (detail) {
      recordSessionStockCount(
        detail,
        detail.categoryId ? (categoryLabelMap.get(detail.categoryId) ?? null) : null,
      );
    }
  }, [categoryLabelMap, detail]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      if (!countId) {
        setLoading(false);
        setLoadError({ message: 'Stock count ID is missing.', notFound: true });
        return;
      }

      setLoading(true);
      setLoadError(null);
      setPostError(null);
      postAttemptRef.current = null;

      try {
        const [fetchedDetail, fetchedCategories] = await Promise.all([
          api.getStockCount(countId, controller.signal),
          catalog.listAllCategories(controller.signal).catch(() => [] as Category[]),
        ]);
        if (!active || controller.signal.aborted) {
          return;
        }
        setCategories(fetchedCategories);
        const initialDrafts = buildInitialDrafts(fetchedDetail);
        commitDetailAndDrafts(fetchedDetail, initialDrafts);
      } catch (err) {
        if (!active || isAbortError(err)) {
          return;
        }
        if (isApiClientError(err)) {
          setLoadError({
            message: err.message,
            requestId: err.requestId,
            notFound: err.status === 404,
          });
        } else {
          setLoadError({ message: 'Unable to load stock count right now.' });
        }
      } finally {
        if (active && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [api, catalog, commitDetailAndDrafts, countId, reloadTick]);

  const reloadDetailPreservingDirty = useCallback(
    async (preserveDirty: boolean): Promise<StockCountDetail | null> => {
      if (!countId) {
        return null;
      }
      const freshDetail = await api.getStockCount(countId);
      if (!mountedRef.current) {
        return null;
      }
      postAttemptRef.current = null;
      const mergedDrafts = mergeReloadedDrafts(freshDetail, draftsRef.current, preserveDirty);
      commitDetailAndDrafts(freshDetail, mergedDrafts);
      return freshDetail;
    },
    [api, commitDetailAndDrafts, countId],
  );

  const enqueueLineSave = useCallback(
    (skuId: string, options?: { reasonOverride?: string }): Promise<boolean> => {
      const preDraft = draftsRef.current[skuId];
      if (!preDraft) {
        return Promise.resolve(false);
      }

      const preParsed = parseCountQuantityInput(preDraft.countedRaw);
      if (!preParsed.valid) {
        commitDrafts({
          ...draftsRef.current,
          [skuId]: {
            ...preDraft,
            saving: false,
            error: preParsed.error,
          },
        });
        return Promise.resolve(false);
      }

      commitDrafts({
        ...draftsRef.current,
        [skuId]: {
          ...preDraft,
          saving: true,
          error: null,
        },
      });

      const task = async (): Promise<boolean> => {
        if (!mountedRef.current) {
          return false;
        }
        const currentDetail = detailRef.current;
        const currentDraft = draftsRef.current[skuId];
        if (!currentDetail || !currentDraft || currentDetail.status === 'POSTED') {
          return false;
        }

        const line = currentDetail.lines.find((item) => item.skuId === skuId);
        if (!line) {
          return false;
        }

        const parsed = parseCountQuantityInput(currentDraft.countedRaw);
        if (!parsed.valid) {
          commitDrafts({
            ...draftsRef.current,
            [skuId]: {
              ...currentDraft,
              saving: false,
              error: parsed.error,
            },
          });
          return false;
        }

        const reasonToSave =
          options?.reasonOverride !== undefined
            ? options.reasonOverride
            : currentDraft.reasonRaw;

        const reasonTrimmed = reasonToSave.trim();
        if (reasonTrimmed.length > 500) {
          commitDrafts({
            ...draftsRef.current,
            [skuId]: {
              ...currentDraft,
              saving: false,
              error: 'Reason must not exceed 500 characters.',
            },
          });
          return false;
        }

        // Do not submit an empty untouched pending line to the backend as null unless clearing a saved count.
        if (
          parsed.value === null &&
          line.countedQuantity === null &&
          !reasonTrimmed &&
          !line.reason
        ) {
          commitDrafts({
            ...draftsRef.current,
            [skuId]: {
              ...currentDraft,
              dirty: false,
              saving: false,
              error: null,
              conflictNotice: null,
            },
          });
          return true;
        }

        const expectedVersion = versionRef.current;
        const observedStockVersion =
          currentDraft.recountRequired || line.observedStockVersion === null
            ? line.currentStockVersion
            : line.observedStockVersion;

        try {
          const saved = await api.saveStockCountLine(currentDetail.countId, skuId, {
            expectedVersion,
            countedQuantity: parsed.value,
            observedStockVersion,
            reason: reasonTrimmed.length > 0 ? reasonTrimmed : null,
          });

          if (!mountedRef.current) {
            return true;
          }

          postAttemptRef.current = null;
          setPostError(null);

          const prevDetailSnapshot = detailRef.current ?? currentDetail;
          const updatedLines = prevDetailSnapshot.lines.map((item) =>
            item.skuId === skuId ? saved.line : item,
          );
          const updatedDetail: StockCountDetail = {
            ...prevDetailSnapshot,
            version: saved.countVersion,
            lines: updatedLines,
          };

          const latestDraft = draftsRef.current[skuId];
          const unchangedWhileInFlight =
            latestDraft &&
            latestDraft.countedRaw === currentDraft.countedRaw &&
            latestDraft.reasonRaw === currentDraft.reasonRaw;

          const nextDrafts = { ...draftsRef.current };
          if (latestDraft) {
            nextDrafts[skuId] = {
              ...latestDraft,
              countedRaw: unchangedWhileInFlight
                ? saved.line.countedQuantity === null
                  ? ''
                  : String(saved.line.countedQuantity)
                : latestDraft.countedRaw,
              reasonRaw: unchangedWhileInFlight
                ? (saved.line.reason ?? '')
                : latestDraft.reasonRaw,
              dirty: !unchangedWhileInFlight,
              saving: false,
              error: null,
              recountRequired: doesLineHaveStaleStockVersion(saved.line),
              conflictNotice: null,
            };
          }

          commitDetailAndDrafts(updatedDetail, nextDrafts);
          return true;
        } catch (err) {
          if (!mountedRef.current) {
            return false;
          }

          if (isApiClientError(err) && err.code === 'STALE_VERSION') {
            setGlobalNotice({
              tone: 'warning',
              message:
                'Another update changed this draft stock count. Latest server quantities were loaded while preserving your unsaved edits.',
              requestId: err.requestId,
            });
            try {
              await reloadDetailPreservingDirty(true);
            } catch {
              const latest = draftsRef.current[skuId];
              if (latest) {
                commitDrafts({
                  ...draftsRef.current,
                  [skuId]: {
                    ...latest,
                    saving: false,
                    error: 'Draft changed on server. Refresh the count before retrying.',
                  },
                });
              }
            }
            return false;
          }

          if (isApiClientError(err) && err.code === 'STOCK_CHANGED') {
            const changed = parseChangedStockSkus(err);
            const changedMap = new Map(changed.map((item) => [item.skuId, item]));
            const latestDetail = detailRef.current ?? currentDetail;
            const nextLines = latestDetail.lines.map((item) => {
              const hit = changedMap.get(item.skuId);
              if (!hit) {
                return item;
              }
              return {
                ...item,
                currentQuantity: hit.currentSellableQuantity,
                currentStockVersion: hit.currentStockVersion,
              };
            });
            const hitInfo = changedMap.get(skuId);
            const latestDraft = draftsRef.current[skuId];
            const nextDrafts = { ...draftsRef.current };
            if (latestDraft) {
              nextDrafts[skuId] = {
                ...latestDraft,
                dirty: true,
                saving: false,
                recountRequired: true,
                error: hitInfo
                  ? `Stock changed while counting (now ${hitInfo.currentSellableQuantity} sellable). Verify shelf count and click Save Line.`
                  : 'Stock changed while counting. Verify shelf count and save again.',
              };
            }
            commitDetailAndDrafts({ ...latestDetail, lines: nextLines }, nextDrafts);
            setGlobalNotice({
              tone: 'warning',
              message:
                'Sellable stock changed during counting. Affected SKUs are highlighted for a physical recount; unaffected counts remain saved.',
              requestId: err.requestId,
            });
            return false;
          }

          if (isApiClientError(err) && err.code === 'STOCK_COUNT_POSTED') {
            setGlobalNotice({
              tone: 'info',
              message: 'This stock count has already been posted and is now read-only.',
              requestId: err.requestId,
            });
            await reloadDetailPreservingDirty(false).catch(() => undefined);
            return false;
          }

          const latest = draftsRef.current[skuId];
          if (latest) {
            commitDrafts({
              ...draftsRef.current,
              [skuId]: {
                ...latest,
                saving: false,
                dirty: true,
                error: isApiClientError(err)
                  ? err.message
                  : 'Unable to save line count. Your entered count has been kept.',
              },
            });
          }
          return false;
        }
      };

      const chained = saveQueueRef.current.then(task, task);
      saveQueueRef.current = chained.then(
        () => undefined,
        () => undefined,
      );
      return chained;
    },
    [api, commitDetailAndDrafts, commitDrafts, reloadDetailPreservingDirty],
  );

  const handleCountInputChange = (skuId: string, rawValue: string) => {
    const prev = draftsRef.current[skuId];
    if (!prev) {
      return;
    }
    const parsed = parseCountQuantityInput(rawValue);
    commitDrafts({
      ...draftsRef.current,
      [skuId]: {
        ...prev,
        countedRaw: rawValue,
        dirty: true,
        error: parsed.valid ? null : parsed.error,
      },
    });
  };

  const handleReasonInputChange = (skuId: string, rawValue: string) => {
    const prev = draftsRef.current[skuId];
    if (!prev) {
      return;
    }
    commitDrafts({
      ...draftsRef.current,
      [skuId]: {
        ...prev,
        reasonRaw: rawValue,
        dirty: true,
        error: rawValue.trim().length > 500 ? 'Reason must not exceed 500 characters.' : prev.error,
      },
    });
  };

  const handleIncrementLine = (line: StockCountLineDetail) => {
    const prev = draftsRef.current[line.skuId];
    if (!prev || detailRef.current?.status === 'POSTED') {
      return;
    }
    const parsed = parseCountQuantityInput(prev.countedRaw);
    const nextQty = parsed.valid && parsed.value !== null ? parsed.value + 1 : 1;
    commitDrafts({
      ...draftsRef.current,
      [line.skuId]: {
        ...prev,
        countedRaw: String(nextQty),
        dirty: true,
        error: null,
      },
    });
    setLastScannedSkuId(line.skuId);
    setScanFeedback(
      `+1 recorded for ${line.productName}${line.size ? ` (${line.size})` : ''} — Counted: ${nextQty}`,
    );
    void enqueueLineSave(line.skuId);
  };

  const handleDiscardLocalConflict = (line: StockCountLineDetail) => {
    const prev = draftsRef.current[line.skuId];
    if (!prev) {
      return;
    }
    commitDrafts({
      ...draftsRef.current,
      [line.skuId]: {
        countedRaw: line.countedQuantity === null ? '' : String(line.countedQuantity),
        reasonRaw: line.reason ?? '',
        dirty: false,
        saving: false,
        error: null,
        recountRequired: doesLineHaveStaleStockVersion(line),
        conflictNotice: null,
      },
    });
  };

  const handleBarcodeLookup = useCallback(
    async (rawCode: string): Promise<boolean> => {
      const currentDetail = detailRef.current;
      if (!currentDetail || currentDetail.status === 'POSTED') {
        return false;
      }

      setIsLookingUpScan(true);
      setScanError(null);

      try {
        const lookup = await api.lookupBarcode(rawCode);
        if (!mountedRef.current) {
          return false;
        }

        const matchedLine = currentDetail.lines.find((item) => item.skuId === lookup.skuId);
        if (!matchedLine) {
          setScanError({
            message: `${lookup.name}${lookup.size ? ` (${lookup.size})` : ''} (${lookup.code}) is outside the scope of this stock count. No quantities were changed.`,
          });
          setScanFeedback(null);
          return false;
        }

        const prevDraft = draftsRef.current[matchedLine.skuId];
        const parsed = prevDraft ? parseCountQuantityInput(prevDraft.countedRaw) : { valid: true as const, value: null };
        const nextCount = parsed.valid && parsed.value !== null ? parsed.value + 1 : 1;

        commitDrafts({
          ...draftsRef.current,
          [matchedLine.skuId]: {
            countedRaw: String(nextCount),
            reasonRaw: prevDraft?.reasonRaw ?? matchedLine.reason ?? '',
            dirty: true,
            saving: false,
            error: null,
            recountRequired: prevDraft?.recountRequired ?? false,
            conflictNotice: prevDraft?.conflictNotice ?? null,
          },
        });

        setLastScannedSkuId(matchedLine.skuId);
        setScanFeedback(
          `Scanned ${matchedLine.productName}${matchedLine.size ? ` (${matchedLine.size})` : ''} · Code ${lookup.code}${lookup.mappingType === 'INTERNAL' && lookup.batchId ? ' (Internal batch tag matched)' : ''} → Counted: ${nextCount}`,
        );
        void enqueueLineSave(matchedLine.skuId);
        return true;
      } catch (err) {
        if (!mountedRef.current) {
          return false;
        }
        if (isApiClientError(err) && err.code === 'BARCODE_NOT_FOUND') {
          setScanError({
            message: `No SKU is linked to barcode "${rawCode}". Check the code or enter the physical count directly on the SKU row.`,
            requestId: err.requestId,
          });
        } else if (isApiClientError(err)) {
          setScanError({ message: err.message, requestId: err.requestId });
        } else {
          setScanError({ message: 'Unable to look up barcode right now. Enter counts manually.' });
        }
        setScanFeedback(null);
        return false;
      } finally {
        if (mountedRef.current) {
          setIsLookingUpScan(false);
        }
      }
    },
    [api, commitDrafts, enqueueLineSave],
  );

  const summaryStats = useMemo(() => {
    const lines = detail?.lines ?? [];
    let countedCount = 0;
    let pendingCount = 0;
    let matchedCount = 0;
    let discrepancyCount = 0;
    let missingReasonCount = 0;
    let recountCount = 0;
    let invalidCount = 0;
    let unsavedCount = 0;
    let savingCount = 0;
    let netDelta = 0;

    const evaluatedLines: Array<{
      line: StockCountLineDetail;
      draft: SkuCountDraft | undefined;
      parsed: ReturnType<typeof parseCountQuantityInput>;
      effectiveCounted: number | null;
      expected: number;
      delta: number | null;
      needsReason: boolean;
      needsRecount: boolean;
    }> = [];

    for (const line of lines) {
      const draft = drafts[line.skuId];
      const parsed = draft
        ? parseCountQuantityInput(draft.countedRaw)
        : { valid: true as const, value: line.countedQuantity };
      const effectiveCounted = parsed.valid ? parsed.value : null;
      const expected = getLineExpectedQuantity(line);
      const delta = computeLineDiscrepancy(effectiveCounted, expected);
      const reasonText = (draft?.reasonRaw ?? line.reason ?? '').trim();
      const needsReason = delta !== null && delta !== 0 && reasonText.length === 0;
      const needsRecount =
        Boolean(draft?.recountRequired) ||
        (detail?.status === 'DRAFT' && doesLineHaveStaleStockVersion(line));

      if (!parsed.valid) {
        invalidCount += 1;
      }
      if (draft?.saving) {
        savingCount += 1;
      }
      if (draft?.dirty) {
        unsavedCount += 1;
      }
      if (needsRecount) {
        recountCount += 1;
      }

      if (effectiveCounted === null) {
        pendingCount += 1;
      } else {
        countedCount += 1;
        if (delta === 0) {
          matchedCount += 1;
        } else if (delta !== null) {
          discrepancyCount += 1;
          netDelta += delta;
          if (needsReason) {
            missingReasonCount += 1;
          }
        }
      }

      evaluatedLines.push({
        line,
        draft,
        parsed,
        effectiveCounted,
        expected,
        delta,
        needsReason,
        needsRecount,
      });
    }

    return {
      totalCount: lines.length,
      countedCount,
      pendingCount,
      matchedCount,
      discrepancyCount,
      missingReasonCount,
      recountCount,
      invalidCount,
      unsavedCount,
      savingCount,
      netDelta,
      evaluatedLines,
    };
  }, [detail, drafts]);

  const filteredRows = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return summaryStats.evaluatedLines.filter((item) => {
      if (q) {
        const matchName = item.line.productName.toLowerCase().includes(q);
        const matchCode = item.line.skuCode.toLowerCase().includes(q);
        const matchSize = (item.line.size ?? '').toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchSize) {
          return false;
        }
      }

      if (filterMode === 'PENDING') {
        return item.effectiveCounted === null;
      }
      if (filterMode === 'DISCREPANCIES') {
        return item.delta !== null && item.delta !== 0;
      }
      if (filterMode === 'MATCHED') {
        return item.delta === 0;
      }
      if (filterMode === 'RECOUNT') {
        return item.needsRecount;
      }
      return true;
    });
  }, [filterMode, filterQuery, summaryStats.evaluatedLines]);

  const handleSaveAllDirty = async () => {
    const dirtySkuIds = summaryStats.evaluatedLines
      .filter((item) => item.draft?.dirty && !item.draft.saving)
      .map((item) => item.line.skuId);

    for (const skuId of dirtySkuIds) {
      await enqueueLineSave(skuId);
    }
  };

  const handleOpenReview = async () => {
    setPostError(null);
    if (summaryStats.unsavedCount > 0) {
      await handleSaveAllDirty();
    }
    setReviewOpen(true);
  };

  const handlePostCount = async (event?: FormEvent) => {
    event?.preventDefault();
    const currentDetail = detailRef.current;
    if (!currentDetail || currentDetail.status === 'POSTED') {
      return;
    }

    if (summaryStats.unsavedCount > 0) {
      await handleSaveAllDirty();
    }

    const latestDetail = detailRef.current;
    if (!latestDetail) {
      return;
    }

    setIsPosting(true);
    setPostError(null);

    const expectedVersion = latestDetail.version;
    if (!postAttemptRef.current || postAttemptRef.current.expectedVersion !== expectedVersion) {
      postAttemptRef.current = {
        expectedVersion,
        idempotencyKey: crypto.randomUUID(),
      };
    }

    const { idempotencyKey } = postAttemptRef.current;

    try {
      const posted = await api.postStockCount(
        latestDetail.countId,
        { expectedVersion },
        idempotencyKey,
      );
      if (!mountedRef.current) {
        return;
      }

      setPostResult(posted);
      setReviewOpen(false);
      setGlobalNotice(null);

      // Update detail state to POSTED immediately, and fetch fresh GET for postedBy/timestamps if needed
      const updatedDetail: StockCountDetail = {
        ...latestDetail,
        status: posted.status,
        version: posted.version,
        postedAt: posted.postedAt,
        lines: latestDetail.lines.map((line) => {
          const adj = posted.adjustments.find((item) => item.skuId === line.skuId);
          if (!adj) {
            return line;
          }
          return {
            ...line,
            expectedQuantity: adj.expectedQuantity,
            countedQuantity: adj.countedQuantity,
            currentQuantity: adj.countedQuantity,
            reason: adj.reason,
          };
        }),
      };

      commitDetailAndDrafts(updatedDetail, buildInitialDrafts(updatedDetail));
      postAttemptRef.current = null;
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }

      if (isApiClientError(err) && err.code === 'STOCK_CHANGED') {
        postAttemptRef.current = null;
        const changed = parseChangedStockSkus(err);
        const changedIds = new Set(changed.map((item) => item.skuId));
        setGlobalNotice({
          tone: 'warning',
          message:
            changed.length > 0
              ? `Stock changed after counting on ${changed.map((c) => `${c.skuCode} (now ${c.currentSellableQuantity} sellable)`).join(', ')}. Unaffected saved lines were kept; recount affected SKUs and save before posting.`
              : 'Live stock changed after counting. Recount highlighted SKUs before posting.',
          requestId: err.requestId,
        });
        setReviewOpen(false);

        try {
          const reloaded = await reloadDetailPreservingDirty(false);
          if (reloaded && changedIds.size > 0) {
            const flagged = { ...draftsRef.current };
            for (const skuId of changedIds) {
              const target = flagged[skuId];
              const hit = changed.find((c) => c.skuId === skuId);
              if (target) {
                flagged[skuId] = {
                  ...target,
                  recountRequired: true,
                  error: hit
                    ? `Live sellable stock is now ${hit.currentSellableQuantity}. Recount and save again.`
                    : 'Live stock changed. Recount and save again.',
                };
              }
            }
            commitDrafts(flagged);
          }
        } catch {
          // Leave existing state with error message below.
        }

        setPostError({
          message: err.message,
          requestId: err.requestId,
        });
        return;
      }

      if (isApiClientError(err) && err.code === 'STALE_VERSION') {
        postAttemptRef.current = null;
        setReviewOpen(false);
        setGlobalNotice({
          tone: 'warning',
          message:
            'Another user updated this draft stock count. Latest server state was reloaded for your review.',
          requestId: err.requestId,
        });
        await reloadDetailPreservingDirty(true).catch(() => undefined);
        return;
      }

      if (isApiClientError(err)) {
        if (!err.retryable) {
          postAttemptRef.current = null;
        }
        setPostError({
          message: err.message,
          requestId: err.requestId,
          retryable: err.retryable,
        });
      } else {
        setPostError({
          message: 'Unable to post stock count right now. Retry safely.',
          retryable: true,
        });
      }
    } finally {
      if (mountedRef.current) {
        setIsPosting(false);
      }
    }
  };

  if (loading && !detail) {
    return (
      <div className="products-page">
        <section className="surface-card" aria-busy="true">
          <h1>Loading Stock Count…</h1>
          <p className="products-header__subtitle">
            Fetching saved SKU lines and live sellable quantities.
          </p>
        </section>
      </div>
    );
  }

  if (loadError && !detail) {
    return (
      <div className="products-page">
        <div className="products-header">
          <div className="products-header__title-group">
            <h1 id="main-content" tabIndex={-1}>
              {loadError.notFound ? 'Stock Count Not Found' : 'Unable to Load Stock Count'}
            </h1>
          </div>
          <div className="products-header__actions">
            <Link to="/inventory/stock-counts" className="btn-secondary">
              Back to Stock Counts
            </Link>
          </div>
        </div>

        <div className="alert-banner alert-banner--error" role="alert">
          <div className="alert-banner__content">
            <p>{loadError.message}</p>
            {loadError.requestId ? (
              <p className="alert-banner__meta">Request ID: {loadError.requestId}</p>
            ) : null}
            <div className="alert-banner__actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReloadTick((tick) => tick + 1)}
              >
                Retry
              </button>
              <Link to="/inventory/stock-counts" className="btn-primary">
                Start or Open Another Count
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return null;
  }

  const isPosted = detail.status === 'POSTED';
  const postedAdjustments =
    postResult?.adjustments ?? (isPosted ? buildDefaultAdjustmentsFromPostedDetail(detail) : []);
  const hasAnyPostedChange = postedAdjustments.some((item) => item.quantityDelta !== 0);

  const canReviewPost =
    !isPosted &&
    summaryStats.totalCount > 0 &&
    summaryStats.pendingCount === 0 &&
    summaryStats.missingReasonCount === 0 &&
    summaryStats.recountCount === 0 &&
    summaryStats.invalidCount === 0 &&
    summaryStats.savingCount === 0 &&
    !isPosting;

  return (
    <div className="products-page">
      <div className="products-header">
        <div className="products-header__title-group">
          <h1 id="main-content" tabIndex={-1}>
            Physical Stock Count — {scopeLabel}
          </h1>
          <p className="products-header__subtitle">
            Count ID: <code>{detail.countId}</code> · Draft link stays valid after refresh.
          </p>
        </div>

        <div className="products-header__actions">
          <Link to="/inventory/stock-counts" className="btn-secondary">
            All Stock Counts
          </Link>
          <Link to="/inventory" className="btn-secondary">
            Inventory Balances
          </Link>
        </div>
      </div>

      <section className="surface-card" aria-label="Stock count summary">
        <dl className="catalog-summary-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <span
                className={`stock-count-badge ${
                  isPosted ? 'stock-count-badge--match' : 'stock-count-badge--warning'
                }`}
              >
                {detail.status}
              </span>
            </dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>{scopeLabel}</dd>
          </div>
          <div>
            <dt>Draft Version</dt>
            <dd>v{detail.version}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatShopTimestamp(detail.createdAt)}</dd>
          </div>
          {detail.postedAt ? (
            <div>
              <dt>Posted At</dt>
              <dd>{formatShopTimestamp(detail.postedAt)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Progress</dt>
            <dd>
              {summaryStats.countedCount} / {summaryStats.totalCount} SKUs counted (
              {summaryStats.pendingCount} pending)
            </dd>
          </div>
        </dl>
      </section>

      {globalNotice ? (
        <div
          className={`alert-banner alert-banner--${globalNotice.tone}`}
          role="alert"
        >
          <div className="alert-banner__content">
            <p>{globalNotice.message}</p>
            {globalNotice.requestId ? (
              <p className="alert-banner__meta">Request ID: {globalNotice.requestId}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {isPosted ? (
        <section className="surface-card catalog-modal-form" aria-label="Posted adjustments summary">
          <div className="stock-count-meta-header">
            <div>
              <h2>Posted Stock Count Summary</h2>
              <p className="catalog-field-hint">
                This physical count is finalized and read-only.
              </p>
            </div>
            <Link to="/inventory" className="btn-primary">
              View Updated Inventory
            </Link>
          </div>

          {!hasAnyPostedChange ? (
            <div className="alert-banner alert-banner--info" role="status">
              <div className="alert-banner__content">
                <p>
                  <strong>No adjustment needed.</strong> Every counted SKU matched its expected
                  sellable quantity cleanly.
                </p>
              </div>
            </div>
          ) : null}

          <div
            className="catalog-table-wrapper"
            role="region"
            aria-labelledby={tableHeadingId}
            tabIndex={0}
          >
            <table className="catalog-table stock-count-table">
              <caption id={tableHeadingId} className="visually-hidden">
                Posted stock count adjustments
              </caption>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU</th>
                  <th scope="col">Size</th>
                  <th scope="col" className="cell-num">
                    Expected
                  </th>
                  <th scope="col" className="cell-num">
                    Counted / Balance
                  </th>
                  <th scope="col" className="cell-num">
                    Adjustment
                  </th>
                  <th scope="col">Basis / Reason</th>
                </tr>
              </thead>
              <tbody>
                {postedAdjustments.map((adj) => (
                  <tr key={adj.skuId}>
                    <th scope="row">{adj.productName}</th>
                    <td className="cell-code" data-label="SKU">
                      <code>{adj.skuCode}</code>
                    </td>
                    <td data-label="Size">{adj.size || '—'}</td>
                    <td className="cell-num" data-label="Expected">
                      {adj.expectedQuantity}
                    </td>
                    <td className="cell-num" data-label="Counted / Balance">
                      {adj.countedQuantity}
                    </td>
                    <td className="cell-num" data-label="Adjustment">
                      <span
                        className={`stock-count-badge ${
                          adj.quantityDelta === 0
                            ? 'stock-count-badge--match'
                            : adj.quantityDelta < 0
                              ? 'stock-count-badge--danger'
                              : 'stock-count-badge--warning'
                        }`}
                      >
                        {formatSignedDelta(adj.quantityDelta)}
                      </span>
                    </td>
                    <td data-label="Basis / Reason">
                      {adj.quantityDelta === 0
                        ? 'Exact match — no adjustment needed'
                        : `${adj.allocationBasis === 'FIFO_SHORTAGE' ? 'FIFO shortage' : adj.allocationBasis === 'AUDIT_SURPLUS' ? 'Audit surplus batch' : 'Adjusted'}${adj.reason ? ` — ${adj.reason}` : ''}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <>
          <BarcodeScannerPanel
            isLookingUp={isLookingUpScan}
            lookupError={scanError}
            inputRef={scannerInputRef}
            onLookupCode={handleBarcodeLookup}
          />

          {scanFeedback ? (
            <div className="alert-banner alert-banner--info" role="status">
              <div className="alert-banner__content">
                <p>{scanFeedback}</p>
              </div>
            </div>
          ) : null}

          <section className="surface-card catalog-results-card" aria-label="Stock count items">
            <div className="catalog-results-bar">
              <div>
                <h2 id={tableHeadingId}>Scoped SKU Lines ({detail.lines.length})</h2>
                <p className="catalog-field-hint">
                  Blank stays <strong>Pending</strong>; enter <code>0</code> when zero pieces remain
                  on shelf. Different sizes stay separate.
                </p>
              </div>

              <div className="stock-count-filter-pills" role="group" aria-label="Filter lines">
                {(
                  [
                    ['ALL', `All (${summaryStats.totalCount})`],
                    ['PENDING', `Pending (${summaryStats.pendingCount})`],
                    ['DISCREPANCIES', `Discrepancies (${summaryStats.discrepancyCount})`],
                    ['MATCHED', `Matched (${summaryStats.matchedCount})`],
                    ['RECOUNT', `Recount (${summaryStats.recountCount})`],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`stock-count-filter-pill${
                      filterMode === mode ? ' stock-count-filter-pill--active' : ''
                    }`}
                    onClick={() => setFilterMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="catalog-filters-card">
              <div className="catalog-filter-field catalog-filter-field--search">
                <label htmlFor={filterSearchId} className="catalog-label">
                  Filter lines by product, SKU, or size
                </label>
                <input
                  id={filterSearchId}
                  type="search"
                  className="catalog-input"
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                  placeholder="Search scoped items…"
                />
              </div>
            </div>

            {filteredRows.length === 0 ? (
              <div className="catalog-empty-state">
                <p>No SKU lines in this stock count match the current filter.</p>
                {filterQuery || filterMode !== 'ALL' ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setFilterQuery('');
                      setFilterMode('ALL');
                    }}
                  >
                    Reset line filter
                  </button>
                ) : null}
              </div>
            ) : (
              <div
                className="catalog-table-wrapper"
                role="region"
                aria-labelledby={tableHeadingId}
                tabIndex={0}
              >
                <table className="catalog-table stock-count-table">
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">SKU</th>
                      <th scope="col">Size</th>
                      <th scope="col" className="cell-num">
                        Expected
                      </th>
                      <th scope="col" className="cell-num">
                        Counted Qty
                      </th>
                      <th scope="col" className="cell-num">
                        Difference
                      </th>
                      <th scope="col">Reason (for discrepancy)</th>
                      <th scope="col">Status / Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(
                      ({ line, draft, parsed, expected, delta, needsReason, needsRecount }) => {
                        const rowHighlighted = lastScannedSkuId === line.skuId;
                        const rowClass = [
                          needsRecount ? 'stock-count-row--recount' : '',
                          rowHighlighted ? 'stock-count-row--scanned' : '',
                        ]
                          .filter(Boolean)
                          .join(' ');

                        return (
                          <tr key={line.skuId} className={rowClass || undefined}>
                            <th scope="row">{line.productName}</th>
                            <td className="cell-code" data-label="SKU">
                              <code>{line.skuCode}</code>
                            </td>
                            <td data-label="Size">{line.size || '—'}</td>
                            <td className="cell-num" data-label="Expected">
                              <div>
                                <span>{expected}</span>
                                {line.expectedQuantity !== null &&
                                line.expectedQuantity !== line.currentQuantity ? (
                                  <div className="catalog-field-hint">
                                    Live: {line.currentQuantity}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="cell-num" data-label="Counted Qty">
                              <div>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  className="stock-count-qty-input"
                                  aria-label={`Counted quantity for ${line.productName} ${line.size ? `${line.size} ` : ''}(${line.skuCode})`}
                                  placeholder="Pending"
                                  value={draft?.countedRaw ?? ''}
                                  aria-invalid={!parsed.valid ? 'true' : undefined}
                                  onChange={(event) =>
                                    handleCountInputChange(line.skuId, event.target.value)
                                  }
                                  onBlur={() => {
                                    const current = draftsRef.current[line.skuId];
                                    if (current?.dirty && parseCountQuantityInput(current.countedRaw).valid) {
                                      void enqueueLineSave(line.skuId);
                                    }
                                  }}
                                />
                                {draft?.error ? (
                                  <div className="catalog-field-error" role="alert">
                                    {draft.error}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="cell-num" data-label="Difference">
                              <span
                                className={`stock-count-badge ${
                                  delta === null
                                    ? 'stock-count-badge--pending'
                                    : delta === 0
                                      ? 'stock-count-badge--match'
                                      : delta < 0
                                        ? 'stock-count-badge--danger'
                                        : 'stock-count-badge--warning'
                                }`}
                              >
                                {delta === null ? 'Pending' : formatSignedDelta(delta)}
                              </span>
                            </td>
                            <td data-label="Reason">
                              <div>
                                <input
                                  type="text"
                                  className="stock-count-reason-input"
                                  aria-label={`Discrepancy reason for ${line.productName} ${line.size ? `${line.size} ` : ''}(${line.skuCode})`}
                                  placeholder={
                                    delta !== null && delta !== 0
                                      ? 'Required for discrepancy'
                                      : 'Optional note'
                                  }
                                  value={draft?.reasonRaw ?? ''}
                                  aria-invalid={needsReason ? 'true' : undefined}
                                  onChange={(event) =>
                                    handleReasonInputChange(line.skuId, event.target.value)
                                  }
                                  onBlur={() => {
                                    const current = draftsRef.current[line.skuId];
                                    if (current?.dirty && parseCountQuantityInput(current.countedRaw).valid) {
                                      void enqueueLineSave(line.skuId);
                                    }
                                  }}
                                />
                                {needsReason ? (
                                  <div className="catalog-field-error">
                                    Reason required before posting.
                                  </div>
                                ) : null}
                                {draft?.conflictNotice ? (
                                  <div className="catalog-field-hint">
                                    Server has{' '}
                                    {draft.conflictNotice.serverCountedQuantity === null
                                      ? 'Pending'
                                      : draft.conflictNotice.serverCountedQuantity}
                                    {draft.conflictNotice.serverReason
                                      ? ` ("${draft.conflictNotice.serverReason}")`
                                      : ''}
                                    .{' '}
                                    <button
                                      type="button"
                                      className="catalog-inline-link"
                                      onClick={() => handleDiscardLocalConflict(line)}
                                    >
                                      Use server value
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td className="cell-actions" data-label="Actions">
                              <div className="cell-actions__group">
                                <button
                                  type="button"
                                  className="btn-table-action"
                                  onClick={() => handleIncrementLine(line)}
                                  aria-label={`Add 1 scanned piece to ${line.skuCode}`}
                                >
                                  +1
                                </button>
                                <button
                                  type="button"
                                  className="btn-table-action stock-count-mobile-scan-action"
                                  onClick={() => {
                                    scannerInputRef.current?.scrollIntoView({ block: 'center' });
                                    scannerInputRef.current?.focus();
                                  }}
                                >
                                  Scan
                                </button>
                                <button
                                  type="button"
                                  className="btn-table-action"
                                  disabled={Boolean(draft?.saving)}
                                  onClick={() => void enqueueLineSave(line.skuId)}
                                >
                                  {draft?.saving
                                    ? 'Saving…'
                                    : needsRecount
                                      ? 'Save Recount'
                                      : draft?.dirty
                                        ? 'Save Line'
                                        : line.countedQuantity !== null
                                          ? 'Saved'
                                          : 'Pending'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="surface-card catalog-modal-form" aria-label="Finalize stock count">
            <div className="stock-count-meta-header">
              <div>
                <h2>Review and Post Adjustments</h2>
                <p className="catalog-field-hint">
                  Counted: {summaryStats.countedCount}/{summaryStats.totalCount} · Discrepancies:{' '}
                  {summaryStats.discrepancyCount} · Net variance:{' '}
                  {formatSignedDelta(summaryStats.netDelta)}
                </p>
              </div>

              <div className="products-header__actions">
                {summaryStats.unsavedCount > 0 ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={summaryStats.savingCount > 0}
                    onClick={() => void handleSaveAllDirty()}
                  >
                    Save Unsaved Edits ({summaryStats.unsavedCount})
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!canReviewPost}
                  onClick={() => void handleOpenReview()}
                >
                  Review &amp; Post Stock Count
                </button>
              </div>
            </div>

            {summaryStats.pendingCount > 0 ? (
              <p className="catalog-field-hint">
                {summaryStats.pendingCount} SKU line
                {summaryStats.pendingCount === 1 ? ' is' : 's are'} still pending (blank). Enter a
                count (or <code>0</code> if none on shelf) for every line before posting.
              </p>
            ) : null}
            {summaryStats.missingReasonCount > 0 ? (
              <p className="catalog-field-error">
                {summaryStats.missingReasonCount} discrepancy line
                {summaryStats.missingReasonCount === 1 ? ' requires' : 's require'} a reason before
                posting.
              </p>
            ) : null}
            {summaryStats.recountCount > 0 ? (
              <p className="catalog-field-error">
                {summaryStats.recountCount} SKU line
                {summaryStats.recountCount === 1 ? ' has' : 's have'} a stock-version change. Save a
                physical recount for highlighted SKUs before posting.
              </p>
            ) : null}

            {postError ? (
              <div className="alert-banner alert-banner--error" role="alert">
                <div className="alert-banner__content">
                  <p>{postError.message}</p>
                  {postError.requestId ? (
                    <p className="alert-banner__meta">Request ID: {postError.requestId}</p>
                  ) : null}
                  {postError.retryable ? (
                    <div className="alert-banner__actions">
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={isPosting}
                        onClick={() => void handlePostCount()}
                      >
                        Retry Post Safely
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {reviewOpen ? (
              <form
                className="catalog-inline-fieldset"
                onSubmit={handlePostCount}
                aria-label="Confirm stock count posting"
              >
                <legend>Confirm Final Posting</legend>
                <p>
                  {summaryStats.discrepancyCount === 0
                    ? 'All counted SKUs match expected quantities. Posting will finalize the count without inventory adjustments.'
                    : `Posting will adjust ${summaryStats.discrepancyCount} SKU line${summaryStats.discrepancyCount === 1 ? '' : 's'} (net ${formatSignedDelta(summaryStats.netDelta)}). Shortages allocate FIFO; surpluses create audit surplus batches.`}
                </p>
                {summaryStats.discrepancyCount > 0 ? (
                  <ul>
                    {summaryStats.evaluatedLines
                      .filter((item) => item.delta !== null && item.delta !== 0)
                      .map((item) => (
                        <li key={item.line.skuId}>
                          <strong>
                            {item.line.productName}
                            {item.line.size ? ` (${item.line.size})` : ''}
                          </strong>{' '}
                          <code>{item.line.skuCode}</code>: Expected {item.expected} → Counted{' '}
                          {item.effectiveCounted} ({formatSignedDelta(item.delta)}) —{' '}
                          {(item.draft?.reasonRaw ?? item.line.reason ?? '').trim()}
                        </li>
                      ))}
                  </ul>
                ) : null}
                <div className="catalog-modal-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={isPosting}
                    onClick={() => setReviewOpen(false)}
                  >
                    Back to Editing
                  </button>
                  <button type="submit" className="btn-primary" disabled={isPosting}>
                    {isPosting ? 'Posting Stock Count…' : 'Confirm & Post Stock Count'}
                  </button>
                </div>
              </form>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
