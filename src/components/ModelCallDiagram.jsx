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
    const jsonString = JSON.stringify(graphData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'agentic_flow.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  React.useEffect(() => {
    if (onExportJson) {
      onExportJson(exportToJson);
    }
  }, [exportToJson, onExportJson]);

  const createAgenticFlow = (flowConfig) => {
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

    // Create edges between the new nodes
    const newEdges = newNodes.slice(0, -1).map((node, index) => ({
      id: `edge-${edges.length + index + 1}`,
      source: node.id,
      target: newNodes[index + 1].id,
      type: 'smoothstep',
    }));
    setEdges((eds) => [...eds, ...newEdges]);
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