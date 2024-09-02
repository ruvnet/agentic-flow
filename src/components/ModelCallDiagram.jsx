import React, { useCallback, useState, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button } from "@/components/ui/button";
import WizardDialog from './WizardDialog';
import NodeSettingsDialog from './NodeSettingsDialog';
import SaveLoadDialog from './SaveLoadDialog';
import AgenticFlowWizard from './AgenticFlowWizard';
import { FiFile, FiSettings, FiCpu, FiCode, FiDatabase } from 'react-icons/fi';

const nodeTypes = {
  custom: ({ data }) => (
    <div className="custom-node">
      <div className="custom-node-header">
        {data.icon}
        <div className="custom-node-title">{data.label}</div>
      </div>
      <div className="custom-node-body">{data.description}</div>
    </div>
  ),
};

const dataPreprocessingFlow = {
  nodes: [
    {
      id: 'input',
      type: 'custom',
      data: { label: 'Data Input', description: 'Load raw data from source', icon: <FiDatabase /> },
      position: { x: 0, y: 0 },
    },
    {
      id: 'cleaning',
      type: 'custom',
      data: { label: 'Data Cleaning', description: 'Handle missing values and outliers', icon: <FiSettings /> },
      position: { x: 250, y: 0 },
    },
    {
      id: 'encoding',
      type: 'custom',
      data: { label: 'Feature Encoding', description: 'Encode categorical variables', icon: <FiCode /> },
      position: { x: 500, y: 0 },
    },
    {
      id: 'scaling',
      type: 'custom',
      data: { label: 'Feature Scaling', description: 'Normalize or standardize features', icon: <FiSettings /> },
      position: { x: 750, y: 0 },
    },
    {
      id: 'output',
      type: 'custom',
      data: { label: 'Preprocessed Data', description: 'Output preprocessed data', icon: <FiFile /> },
      position: { x: 1000, y: 0 },
    },
  ],
  edges: [
    { id: 'e1-2', source: 'input', target: 'cleaning', animated: true, style: { stroke: 'url(#edge-gradient)' } },
    { id: 'e2-3', source: 'cleaning', target: 'encoding', animated: true, style: { stroke: 'url(#edge-gradient)' } },
    { id: 'e3-4', source: 'encoding', target: 'scaling', animated: true, style: { stroke: 'url(#edge-gradient)' } },
    { id: 'e4-5', source: 'scaling', target: 'output', animated: true, style: { stroke: 'url(#edge-gradient)' } },
  ],
};

const modelExecutionFlow = {
  nodes: [
    {
      id: 'model-execution-1',
      type: 'custom',
      data: { label: 'Multi-Modal Fusion', description: 'Execute multi-modal fusion model', icon: <FiCpu /> },
      position: { x: 500, y: 300 },
    },
  ],
  edges: [],
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
      type: 'custom',
      data: { 
        label: nodeData.name,
        description: nodeData.description || '',
        icon: <FiSettings />,
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
          return { ...node, data: { ...node.data, ...newData } };
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
      // ... (existing code for other flow types)
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
        nodeTypes={nodeTypes}
        fitView
      >
        <Background variant="dots" gap={12} size={1} />
        <Controls />
        <MiniMap />
        <svg width="0" height="0">
          <defs>
            <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ae53ba" />
              <stop offset="100%" stopColor="#2a8af6" />
            </linearGradient>
          </defs>
        </svg>
      </ReactFlow>
      <div className="absolute top-4 left-4 z-10 bg-background/80 backdrop-blur-sm p-4 rounded-lg shadow-md">
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