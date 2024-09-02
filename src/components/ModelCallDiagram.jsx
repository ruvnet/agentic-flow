import React, { useCallback, useState, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from "@/components/ui/button";
import WizardDialog from './WizardDialog';
import NodeSettingsDialog from './NodeSettingsDialog';
import SaveLoadDialog from './SaveLoadDialog';
import AgenticFlowWizard from './AgenticFlowWizard';

const dataPreprocessingFlow = {
  "nodes": [
    {
      "id": "input",
      "type": "input",
      "data": {
        "label": "Data Input",
        "description": "Load raw data from source"
      },
      "position": { "x": 0, "y": 0 }
    },
    {
      "id": "cleaning",
      "type": "default",
      "data": {
        "label": "Data Cleaning",
        "description": "Handle missing values, outliers, and inconsistencies",
        "options": [
          {
            "name": "missing_values",
            "type": "select",
            "choices": ["drop", "mean", "median", "mode", "constant"],
            "default": "mean"
          },
          {
            "name": "outlier_method",
            "type": "select",
            "choices": ["zscore", "iqr", "isolation_forest"],
            "default": "zscore"
          },
          {
            "name": "outlier_threshold",
            "type": "float",
            "default": 3.0
          }
        ]
      },
      "position": { "x": 200, "y": 0 }
    },
    {
      "id": "encoding",
      "type": "default",
      "data": {
        "label": "Feature Encoding",
        "description": "Encode categorical variables",
        "options": [
          {
            "name": "method",
            "type": "select",
            "choices": ["one_hot", "label", "binary", "frequency"],
            "default": "one_hot"
          },
          {
            "name": "handle_unknown",
            "type": "select",
            "choices": ["error", "ignore"],
            "default": "error"
          }
        ]
      },
      "position": { "x": 400, "y": 0 }
    },
    {
      "id": "scaling",
      "type": "default",
      "data": {
        "label": "Feature Scaling",
        "description": "Normalize or standardize numerical features",
        "options": [
          {
            "name": "method",
            "type": "select",
            "choices": ["minmax", "standard", "robust", "normalizer"],
            "default": "standard"
          },
          {
            "name": "feature_range",
            "type": "tuple",
            "default": [0, 1]
          }
        ]
      },
      "position": { "x": 600, "y": 0 }
    },
    {
      "id": "feature_selection",
      "type": "default",
      "data": {
        "label": "Feature Selection",
        "description": "Select most relevant features",
        "options": [
          {
            "name": "method",
            "type": "select",
            "choices": ["variance", "correlation", "mutual_info", "chi2", "rfe"],
            "default": "variance"
          },
          {
            "name": "k",
            "type": "int",
            "default": 10
          }
        ]
      },
      "position": { "x": 800, "y": 0 }
    },
    {
      "id": "dimensionality_reduction",
      "type": "default",
      "data": {
        "label": "Dimensionality Reduction",
        "description": "Reduce number of features",
        "options": [
          {
            "name": "method",
            "type": "select",
            "choices": ["pca", "lda", "t-sne", "umap"],
            "default": "pca"
          },
          {
            "name": "n_components",
            "type": "int",
            "default": 2
          }
        ]
      },
      "position": { "x": 1000, "y": 0 }
    },
    {
      "id": "balancing",
      "type": "default",
      "data": {
        "label": "Class Balancing",
        "description": "Handle imbalanced datasets",
        "options": [
          {
            "name": "method",
            "type": "select",
            "choices": ["oversampling", "undersampling", "smote"],
            "default": "smote"
          },
          {
            "name": "ratio",
            "type": "float",
            "default": 1.0
          }
        ]
      },
      "position": { "x": 1200, "y": 0 }
    },
    {
      "id": "output",
      "type": "output",
      "data": {
        "label": "Preprocessed Data",
        "description": "Output preprocessed data for modeling"
      },
      "position": { "x": 1400, "y": 0 }
    }
  ],
  "edges": [
    { "id": "e1", "source": "input", "target": "cleaning" },
    { "id": "e2", "source": "cleaning", "target": "encoding" },
    { "id": "e3", "source": "encoding", "target": "scaling" },
    { "id": "e4", "source": "scaling", "target": "feature_selection" },
    { "id": "e5", "source": "feature_selection", "target": "dimensionality_reduction" },
    { "id": "e6", "source": "dimensionality_reduction", "target": "balancing" },
    { "id": "e7", "source": "balancing", "target": "output" }
  ]
};

const modelExecutionFlow = {
  "nodes": [
    {
      "id": "model-execution-1",
      "type": "modelExecution",
      "data": {
        "label": "Multi-Modal Fusion",
        "description": "Execute multi-modal fusion model",
        "settings": {
          "name": "Multi-Modal Fusion",
          "type": "Data Fusion",
          "modelName": {
            "type": "select",
            "label": "Model Name",
            "options": [
              "GPT-3.5-turbo",
              "GPT-4",
              "BERT",
              "RoBERTa",
              "CLIP",
              "Custom Model"
            ],
            "default": "Select model"
          },
          "temperature": {
            "type": "float",
            "label": "Temperature",
            "min": 0,
            "max": 2,
            "step": 0.1,
            "default": 0.7
          },
          "maxTokens": {
            "type": "integer",
            "label": "Max Tokens",
            "min": 1,
            "max": 4096,
            "default": 100
          },
          "role": {
            "type": "string",
            "label": "Role",
            "placeholder": "Enter model role or context"
          },
          "capabilities": {
            "type": "textarea",
            "label": "Capabilities",
            "placeholder": "Describe model capabilities and limitations"
          },
          "topP": {
            "type": "float",
            "label": "Top P",
            "min": 0,
            "max": 1,
            "step": 0.01,
            "default": 1
          },
          "frequencyPenalty": {
            "type": "float",
            "label": "Frequency Penalty",
            "min": -2,
            "max": 2,
            "step": 0.1,
            "default": 0
          },
          "presencePenalty": {
            "type": "float",
            "label": "Presence Penalty",
            "min": -2,
            "max": 2,
            "step": 0.1,
            "default": 0
          },
          "stopSequences": {
            "type": "array",
            "label": "Stop Sequences",
            "items": {
              "type": "string"
            },
            "default": []
          },
          "batchSize": {
            "type": "integer",
            "label": "Batch Size",
            "min": 1,
            "max": 64,
            "default": 1
          },
          "seed": {
            "type": "integer",
            "label": "Random Seed",
            "min": 0,
            "default": null
          },
          "outputFormat": {
            "type": "select",
            "label": "Output Format",
            "options": ["JSON", "Plain Text", "Markdown", "HTML"],
            "default": "JSON"
          },
          "useCache": {
            "type": "boolean",
            "label": "Use Cache",
            "default": true
          },
          "timeout": {
            "type": "integer",
            "label": "Timeout (seconds)",
            "min": 1,
            "max": 300,
            "default": 30
          }
        },
        "inputConnectors": [
          {
            "id": "input-1",
            "label": "Text Input"
          },
          {
            "id": "input-2",
            "label": "Image Input"
          }
        ],
        "outputConnectors": [
          {
            "id": "output-1",
            "label": "Fused Output"
          }
        ]
      },
      "position": {
        "x": 500,
        "y": 300
      },
      "width": 250,
      "height": 150
    }
  ],
  "edges": []
};

const flowTypeToNodes = {
  "Data Preprocessing": ["Input", "Cleansing", "Transformation", "Output"],
  "Model Execution": ["Input", "Model", "Inference", "Output"],
  "Conditional Branching": ["Input", "Condition", "Branch A", "Branch B", "Merge", "Output"],
  "Iterative Processing": ["Input", "Loop Start", "Process", "Loop End", "Output"],
  "Parallel Processing": ["Input", "Split", "Process A", "Process B", "Join", "Output"],
  "Data Fusion": ["Input A", "Input B", "Fusion", "Analysis", "Output"],
  "Feedback Loops": ["Input", "Process", "Evaluation", "Feedback", "Output"],
  "Pipeline Orchestration": ["Stage 1", "Stage 2", "Stage 3", "Stage 4", "Output"],
  "Interactive Query": ["User Input", "Query Processing", "Database", "Result Formatting", "Output"],
  "Output Generation": ["Input", "Processing", "Formatting", "Visualization", "Output"]
};

const ModelCallDiagram = ({ onExportJson }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isSaveLoadDialogOpen, setIsSaveLoadDialogOpen] = useState(false);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const addNode = useCallback((nodeData) => {
    const newNode = {
      id: `node-${nodes.length + 1}`,
      data: { 
        label: nodeData.name,
        ...nodeData
      },
      position: { x: Math.random() * 500, y: Math.random() * 500 },
    };
    setNodes((nds) => nds.concat(newNode));
  }, [nodes, setNodes]);

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const onSaveNodeSettings = useCallback((nodeId, newData) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          return { ...node, data: newData };
        }
        return node;
      })
    );
    setSelectedNode(null);
  }, [setNodes]);

  const onDeleteNode = useCallback((nodeId) => {
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  const handleSave = (savedGraph) => {
    console.log('Graph saved:', savedGraph);
  };

  const handleLoad = (loadedGraphData) => {
    setNodes(loadedGraphData.nodes);
    setEdges(loadedGraphData.edges);
  };

  const exportToJson = useCallback(() => {
    const graphData = {
      nodes,
      edges,
    };
    onExportJson(graphData);
  }, [nodes, edges, onExportJson]);

  React.useEffect(() => {
    exportToJson();
  }, [exportToJson]);

  const createAgenticFlow = (flowConfig) => {
    if (flowConfig.type === "Data Preprocessing") {
      setNodes(dataPreprocessingFlow.nodes);
      setEdges(dataPreprocessingFlow.edges);
    } else if (flowConfig.type === "Model Execution") {
      setNodes(modelExecutionFlow.nodes);
      setEdges(modelExecutionFlow.edges);
    } else {
      const nodeTypes = flowTypeToNodes[flowConfig.type] || ["Default"];
      const newNodes = nodeTypes.map((nodeType, index) => ({
        id: `flow-${nodes.length + index + 1}`,
        type: 'default',
        data: { 
          label: nodeType,
          type: flowConfig.type,
          description: `${flowConfig.description} - ${nodeType}`
        },
        position: { x: 100 + index * 150, y: 100 + index * 50 },
      }));
      setNodes((nds) => [...nds, ...newNodes]);

      const newEdges = newNodes.slice(0, -1).map((node, index) => ({
        id: `edge-${edges.length + index + 1}`,
        source: node.id,
        target: newNodes[index + 1].id,
        type: 'smoothstep',
      }));
      setEdges((eds) => [...eds, ...newEdges]);
    }
  };

  const clearDiagram = () => {
    setNodes([]);
    setEdges([]);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      <div className="absolute top-4 left-4 z-10 bg-white p-4 rounded-lg shadow-md">
        <div className="flex flex-col gap-2">
          <AgenticFlowWizard 
            onCreateFlow={createAgenticFlow} 
            onClearDiagram={clearDiagram}
            onSaveFlow={exportToJson}
          />
          <WizardDialog onAddNode={addNode} />
          <Button onClick={() => setIsSaveLoadDialogOpen(true)} className="w-48">Save/Load Graph</Button>
        </div>
      </div>
      {selectedNode && (
        <div className="absolute bottom-4 right-4 z-10">
          <NodeSettingsDialog
            node={selectedNode}
            onSave={onSaveNodeSettings}
            onDelete={() => onDeleteNode(selectedNode.id)}
          />
        </div>
      )}
      <SaveLoadDialog
        isOpen={isSaveLoadDialogOpen}
        onClose={() => setIsSaveLoadDialogOpen(false)}
        onSave={handleSave}
        onLoad={handleLoad}
        graphData={{ nodes, edges }}
      />
    </div>
  );
};

export default ModelCallDiagram;