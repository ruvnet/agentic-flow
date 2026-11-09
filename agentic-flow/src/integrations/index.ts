/**
 * agentic-flow/integrations — programmatic access to the optional ruvnet
 * package integrations (each with a built-in fallback).
 */

export { scanPromptInjection, promptInjectionEngine, getInjectionPolicy } from './prompt-injection.js';
export type { InjectionScan, InjectionThreat, InjectionPolicy, InjectionSeverity } from './prompt-injection.js';
export { partitionTaskGraph } from './task-partition.js';
export type { TaskDependency, TaskPartition } from './task-partition.js';
export { scheduleTaskGraph } from './task-schedule.js';
export type { ScheduleTask, ScheduleDependency, TaskSchedule } from './task-schedule.js';
export { solveLinearSystem, pageRank, loadSublinearCore } from './sublinear.js';
export type { LinearSolveResult, PageRankResult, PageRankOptions, PageRankEdge, MatrixInput, SparseEntry, SolveMethod, SublinearEngine } from './sublinear.js';
export { applyAgentBoosterEdit, getAgentBoosterLibrary } from './agent-booster.js';
export type { BoosterEditResult } from './agent-booster.js';
export { OnnxWasmTextEmbedder, getOnnxWasmEmbedder, loadOnnxWasmModule, onnxWasmModelCached } from './onnx-wasm-embedder.js';
export { isOptionalInstalled } from './optional.js';
