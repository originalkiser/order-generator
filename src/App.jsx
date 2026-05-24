import { useState, useEffect } from "react";
import { VERSION, C } from "./constants.js";
import { loadUomMappings, loadCategoryUom, loadPrefixSuffixRules, findBestSavedMapping } from "./utils/storage.js";
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
  const [step, setStep] = useState(0);
  const [buildMode, setBuildMode] = useState("upload"); // "upload" | "manual"
  const [fileData, setFileData] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [targetDays, setTargetDays] = useState(14);
  const [usageConfig, setUsageConfig] = useState(null);
  const [manualEntry, setManualEntry] = useState(null);
  const [orderLimits, setOrderLimits] = useState(null);
  const [finalRows, setFinalRows] = useState(null);
  const [savedPendingOrders, setSavedPendingOrders] = useState([]);
  const [manualBuiltRows, setManualBuiltRows] = useState(null);
  const [manualLocations, setManualLocations] = useState([]);
  const [snakeOpen, setSnakeOpen] = useState(false);
  useEffect(() => { setSnakeOpen(false); }, [step]);
  const [savedMapState, setSavedMapState] = useState(null);
  const [suggestion, setSuggestion] = useState(null);

  const handleFileUploaded = (d) => {
    setFileData(d);
    setSavedMapState(null);
    setSuggestion(findBestSavedMapping(d.headers));
    setStep(1);
  };

  const [uomMappings, setUomMappings] = useState(() => loadUomMappings());
  const [categoryUomSettings, setCategoryUomSettings] = useState(() => loadCategoryUom());
  const [prefixSuffixRules, setPrefixSuffixRules] = useState(() => loadPrefixSuffixRules());

  const handleMapConfirm = (m, td, uc, me, ol, ms) => {
    setMapping(m); setTargetDays(td); setUsageConfig(uc);
    setManualEntry(me); setOrderLimits(ol);
    setSavedMapState(ms);
    setStep(2);
  };

  const handleUomConfirm = (uomMaps, catUom, psRules) => {
    setUomMappings(uomMaps);
    setCategoryUomSettings(catUom);
    setPrefixSuffixRules(psRules);
    setStep(3);
  };

  const handleManualBuildConfirm = (rows, locs) => {
    setManualBuiltRows(rows);
    setManualLocations(locs);
    setStep(3);
  };

  const handleReviewBack = () => {
    if (buildMode === "manual") setStep(1);
    else setStep(2);
  };

  const [showDataSource, setShowDataSource] = useState(false);
  const [activeConnName, setActiveConnName] = useState(null);

  const handleLoadFromSource = (data, connName) => {
    setShowDataSource(false);
    setActiveConnName(connName);
    setMapping(null); setUsageConfig(null); setManualEntry(null);
    setOrderLimits(null); setFinalRows(null); setSavedMapState(null);
    setSuggestion(findBestSavedMapping(data.headers));
    setFileData(data);
    setStep(1);
  };

  const handleNewOrder = () => {
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
              initialRows={buildMode === "manual" ? manualBuiltRows : null}
              manualLocations={buildMode === "manual" ? manualLocations : []}
              onConfirm={(rows, pos) => { setFinalRows(rows); setSavedPendingOrders(pos || []); setStep(4); }}
              onBack={handleReviewBack} />
          </ErrorBoundary>
        )}
        {step === 4 && finalRows && <ErrorBoundary><ExportStep rows={finalRows} onBack={() => setStep(3)} /></ErrorBoundary>}
      </div>
    </div>
  );
}
