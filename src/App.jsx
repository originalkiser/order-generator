import { useState, useEffect, useRef, useCallback } from "react";
import { VERSION, C } from "./constants.js";
import { loadUomMappings, loadCategoryUom, loadPrefixSuffixRules, findBestSavedMapping, saveSession, loadSession, clearSession } from "./utils/storage.js";
import { buildPendingIndex } from "./utils/calc.js";
import { ErrorBoundary } from "./components/ui.jsx";
import { SnakeGame } from "./components/SnakeGame.jsx";
import { StepBar } from "./components/StepBar.jsx";
import { DataSourcePanel } from "./panels/DataSourcePanel.jsx";
import { UploadStep } from "./steps/UploadStep.jsx";
import { ManualBuildStep } from "./steps/ManualBuildStep.jsx";
import { MapStep } from "./steps/MapStep.jsx";
import { UomStep } from "./steps/UomStep.jsx";
import { ReviewStep } from "./steps/ReviewStep.jsx";
import { ExportStep } from "./steps/ExportStep.jsx";

export default function App() {
  // Loaded once at mount; never changes — used only for initial state values
  const _s = useRef(loadSession()).current;

  const [step, setStep] = useState(_s?.step ?? 0);
  const [buildMode, setBuildMode] = useState(_s?.buildMode ?? "upload");
  const [fileData, setFileData] = useState(_s?.fileData ?? null);
  const [mapping, setMapping] = useState(_s?.mapping ?? null);
  const [targetDays, setTargetDays] = useState(_s?.targetDays ?? 14);
  const [usageConfig, setUsageConfig] = useState(_s?.usageConfig ?? null);
  const [manualEntry, setManualEntry] = useState(_s?.manualEntry ?? null);
  const [orderLimits, setOrderLimits] = useState(_s?.orderLimits ?? null);
  const [finalRows, setFinalRows] = useState(_s?.finalRows ?? null);
  const [savedPendingOrders, setSavedPendingOrders] = useState(() => {
    const pos = _s?.savedPendingOrders;
    if (!pos?.length) return [];
    return pos.map(po => ({ ...po, _index: buildPendingIndex(po) }));
  });
  const [manualBuiltRows, setManualBuiltRows] = useState(_s?.manualBuiltRows ?? null);
  const [manualLocations, setManualLocations] = useState(_s?.manualLocations ?? []);
  const [snakeOpen, setSnakeOpen] = useState(false);
  useEffect(() => { setSnakeOpen(false); }, [step]);
  const [savedMapState, setSavedMapState] = useState(_s?.savedMapState ?? null);
  const [suggestion, setSuggestion] = useState(null);
  const [showDataSource, setShowDataSource] = useState(false);
  const [activeConnName, setActiveConnName] = useState(_s?.activeConnName ?? null);

  const [uomMappings, setUomMappings] = useState(() => loadUomMappings());
  const [categoryUomSettings, setCategoryUomSettings] = useState(() => loadCategoryUom());
  const [prefixSuffixRules, setPrefixSuffixRules] = useState(() => loadPrefixSuffixRules());

  // Snapshot of ReviewStep's current rows — updated via callback, not state (avoids extra renders).
  // Starts from session so a refresh on step 3 restores edited order quantities.
  const reviewRowsRef = useRef(_s?.reviewRows ?? null);
  const handleRowsSnapshot = useCallback((rows) => { reviewRowsRef.current = rows; }, []);

  // Clear review snapshot whenever leaving step 3 (so stale rows don't leak into a fresh Review mount)
  useEffect(() => { if (step !== 3) reviewRowsRef.current = null; }, [step]);

  // Persist session on every wizard-state change so refresh lands back in the right place
  useEffect(() => {
    if (step === 0 && !fileData && !manualBuiltRows) { clearSession(); return; }
    saveSession({
      step, buildMode, fileData, mapping, targetDays, usageConfig, manualEntry,
      orderLimits, finalRows, manualBuiltRows, manualLocations, savedMapState, activeConnName,
      savedPendingOrders: savedPendingOrders.map(({ _index, ...rest }) => rest),
      reviewRows: reviewRowsRef.current,
    });
  }, [step, buildMode, fileData, mapping, targetDays, usageConfig, manualEntry, orderLimits,
      finalRows, savedPendingOrders, manualBuiltRows, manualLocations, savedMapState, activeConnName]);

  // Also flush on unload to capture any row edits made since the last state change
  useEffect(() => {
    const flush = () => {
      if (step === 0 && !fileData && !manualBuiltRows) return;
      saveSession({
        step, buildMode, fileData, mapping, targetDays, usageConfig, manualEntry,
        orderLimits, finalRows, manualBuiltRows, manualLocations, savedMapState, activeConnName,
        savedPendingOrders: savedPendingOrders.map(({ _index, ...rest }) => rest),
        reviewRows: reviewRowsRef.current,
      });
    };
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [step, buildMode, fileData, mapping, targetDays, usageConfig, manualEntry, orderLimits,
      finalRows, savedPendingOrders, manualBuiltRows, manualLocations, savedMapState, activeConnName]);

  const handleFileUploaded = (d) => {
    reviewRowsRef.current = null;
    setFileData(d);
    setSavedMapState(null);
    setSuggestion(findBestSavedMapping(d.headers));
    setStep(1);
  };

  const handleMapConfirm = (m, td, uc, me, ol, ms) => {
    reviewRowsRef.current = null;
    setMapping(m); setTargetDays(td); setUsageConfig(uc);
    setManualEntry(me); setOrderLimits(ol);
    setSavedMapState(ms);
    setStep(2);
  };

  const handleUomConfirm = (uomMaps, catUom, psRules) => {
    reviewRowsRef.current = null;
    setUomMappings(uomMaps);
    setCategoryUomSettings(catUom);
    setPrefixSuffixRules(psRules);
    setStep(3);
  };

  const handleManualBuildConfirm = (rows, locs) => {
    reviewRowsRef.current = null;
    setManualBuiltRows(rows);
    setManualLocations(locs);
    setStep(3);
  };

  const handleReviewBack = () => {
    if (buildMode === "manual") setStep(1);
    else setStep(2);
  };

  const handleLoadFromSource = (data, connName) => {
    reviewRowsRef.current = null;
    setShowDataSource(false);
    setActiveConnName(connName);
    setMapping(null); setUsageConfig(null); setManualEntry(null);
    setOrderLimits(null); setFinalRows(null); setSavedMapState(null);
    setSuggestion(findBestSavedMapping(data.headers));
    setFileData(data);
    setStep(1);
  };

  const handleNewOrder = () => {
    clearSession();
    reviewRowsRef.current = null;
    setStep(0);
    setBuildMode("upload");
    setFileData(null);
    setMapping(null);
    setUsageConfig(null);
    setManualEntry(null);
    setOrderLimits(null);
    setFinalRows(null);
    setSavedMapState(null);
    setSuggestion(null);
    setManualBuiltRows(null);
    setManualLocations([]);
    setSavedPendingOrders([]);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif", color: C.text, paddingBottom: 60 }}>
      {showDataSource && <DataSourcePanel onLoadData={handleLoadFromSource} onClose={() => setShowDataSource(false)} />}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "18px 32px", display: "flex", alignItems: "center", gap: 14, marginBottom: 40 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, #7b5bf7)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📦</div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: -0.3 }}>OrderGen</span>
            <span style={{ color: C.muted, fontSize: 11, fontWeight: 600 }}>{VERSION}</span>
          </div>
          <div style={{ color: C.muted, fontSize: 12 }}>
            Inventory-driven order planning
            {activeConnName && <span style={{ color: C.accent, marginLeft: 8 }}>· {activeConnName}</span>}
          </div>
        </div>
        <button onClick={() => setShowDataSource(true)} style={{ background: activeConnName ? C.accentDim : "transparent", border: `1px solid ${activeConnName ? C.accent : C.border}`, borderRadius: 8, color: activeConnName ? C.accent : C.muted, fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "8px 16px", transition: "all .15s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent; }}
          onMouseLeave={e => { if (!activeConnName) { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; } }}>
          ⚡ Data Source
        </button>
        {step > 0 && (
          <button onClick={handleNewOrder} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontFamily: "inherit", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "8px 16px", transition: "all .15s" }}
            onMouseEnter={e => { e.target.style.borderColor = C.accent; e.target.style.color = C.accent; }}
            onMouseLeave={e => { e.target.style.borderColor = C.border; e.target.style.color = C.muted; }}>
            ↩ Start New Order
          </button>
        )}
      </div>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "0 24px" }}>
        <StepBar current={step} buildMode={buildMode} onReviewTripleClick={() => setSnakeOpen(v => !v)} />
        {snakeOpen && <SnakeGame onClose={() => setSnakeOpen(false)} />}
        {step === 0 && <UploadStep onData={handleFileUploaded} onManualBuild={() => { setBuildMode("manual"); setStep(1); }} />}
        {step === 1 && buildMode === "manual" && (
          <ManualBuildStep onConfirm={handleManualBuildConfirm} onBack={() => { setBuildMode("upload"); setStep(0); }} />
        )}
        {step === 1 && buildMode === "upload" && fileData && (
          <MapStep
            headers={fileData.headers} rows={fileData.rows} fileName={fileData.fileName}
            initialState={savedMapState}
            suggestion={!savedMapState ? suggestion : null}
            onConfirm={handleMapConfirm}
          />
        )}
        {step === 2 && buildMode === "upload" && fileData && mapping && usageConfig && (
          <UomStep
            rawRows={fileData.rows} headers={fileData.headers} mapping={mapping}
            usageConfig={usageConfig} manualEntry={manualEntry}
            hasCategory={!!mapping.category} hasUom={!!mapping.uom}
            productRules={[]}
            initialUomMappings={uomMappings}
            initialCategoryUomSettings={categoryUomSettings}
            initialPrefixSuffixRules={prefixSuffixRules}
            onBack={() => setStep(1)}
            onConfirm={handleUomConfirm}
          />
        )}
        {step === 3 && (buildMode === "manual" ? manualBuiltRows : (fileData && mapping && usageConfig)) && (
          <ErrorBoundary>
            <ReviewStep
              rawRows={buildMode === "manual" ? [] : fileData.rows}
              headers={buildMode === "manual" ? [] : fileData.headers}
              mapping={buildMode === "manual" ? {} : mapping}
              targetDays={targetDays}
              usageConfig={buildMode === "manual" ? { mode: "direct" } : usageConfig}
              manualEntry={buildMode === "manual" ? null : manualEntry}
              orderLimits={buildMode === "manual" ? null : orderLimits}
              uomMappings={uomMappings} categoryUomSettings={categoryUomSettings} prefixSuffixRules={prefixSuffixRules}
              initialPendingOrders={savedPendingOrders}
              isManualBuild={buildMode === "manual"}
              initialRows={buildMode === "manual" ? manualBuiltRows : (reviewRowsRef.current ?? null)}
              manualLocations={buildMode === "manual" ? manualLocations : []}
              onRowsSnapshot={handleRowsSnapshot}
              onConfirm={(rows, pos) => { setFinalRows(rows); setSavedPendingOrders(pos || []); setStep(4); }}
              onBack={handleReviewBack} />
          </ErrorBoundary>
        )}
        {step === 4 && finalRows && <ErrorBoundary><ExportStep rows={finalRows} onBack={() => setStep(3)} /></ErrorBoundary>}
      </div>
    </div>
  );
}
