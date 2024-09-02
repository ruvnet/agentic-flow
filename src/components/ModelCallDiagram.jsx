import React, { useCallback, useState } from 'react';
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
import NodeSettingsDialog from './NodeSettingsDialog';
import SaveLoadDialog from './SaveLoadDialog';

const initialNodes = [
  {
    id: "input-1",
    type: "input",
    data: { label: "Image Input", type: "Data Input", description: "Upload or select image files" },
    position: { x: 100, y: 100 },
    style: { width: 150, height: 50 }
  },
  {
    id: "input-2",
    type: "input",
    data: { label: "Text Input", type: "Data Input", description: "Enter text or load from file" },
    position: { x: 100, y: 200 },
    style: { width: 150, height: 50 }
  },
  {
    id: "preprocess-1",
    type: "default",
    data: { label: "Image Preprocessing", type: "Data Preprocessing", description: "Resize, normalize, and augment images" },
    position: { x: 300, y: 100 },
    style: { width: 180, height: 60 }
  },
  {
    id: "preprocess-2",
    type: "default",
    data: { label: "Text Preprocessing", type: "Data Preprocessing", description: "Tokenize, clean, and embed text" },
    position: { x: 300, y: 200 },
    style: { width: 180, height: 60 }
  },
  {
    id: "model-1",
    type: "default",
    data: { label: "Image Model", type: "Model Execution", description: "CNN for image classification" },
    position: { x: 550, y: 100 },
    style: { width: 160, height: 60 }
  },
  {
    id: "model-2",
    type: "default",
    data: { label: "Text Model", type: "Model Execution", description: "Transformer for text analysis" },
    position: { x: 550, y: 200 },
    style: { width: 160, height: 60 }
  },
  {
    id: "fusion",
    type: "default",
    data: { label: "Multi-Modal Fusion", type: "Data Fusion", description: "Combine image and text features" },
    position: { x: 800, y: 150 },
    style: { width: 180, height: 60 }
  },
  {
    id: "postprocess",
    type: "default",
    data: { label: "Post-processing", type: "Data Processing", description: "Refine and format results" },
    position: { x: 1050, y: 150 },
    style: { width: 160, height: 60 }
  },
  {
    id: "output",
    type: "output",
    data: { label: "Final Output", type: "Data Output", description: "Generate visualizations and reports" },
    position: { x: 1300, y: 150 },
    style: { width: 150, height: 50 }
  }
];

const initialEdges = [
  { id: "edge-1", source: "input-1", target: "preprocess-1", type: "smoothstep" },
  { id: "edge-2", source: "input-2", target: "preprocess-2", type: "smoothstep" },
  { id: "edge-3", source: "preprocess-1", target: "model-1", type: "smoothstep" },
  { id: "edge-4", source: "preprocess-2", target: "model-2", type: "smoothstep" },
  { id: "edge-5", source: "model-1", target: "fusion", type: "smoothstep" },
  { id: "edge-6", source: "model-2", target: "fusion", type: "smoothstep" },
  { id: "edge-7", source: "fusion", target: "postprocess", type: "smoothstep" },
  { id: "edge-8", source: "postprocess", target: "output", type: "smoothstep" }
];

const ModelCallDiagram = ({ onExportJson }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState(null);
  const [isSaveLoadDialogOpen, setIsSaveLoadDialogOpen] = useState(false);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

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