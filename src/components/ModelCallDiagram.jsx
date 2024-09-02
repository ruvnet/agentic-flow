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
import WizardDialog from './WizardDialog';
import NodeSettingsDialog from './NodeSettingsDialog';
import SaveLoadDialog from './SaveLoadDialog';

const initialNodes = [
  { 
    id: 'model1', 
    type: 'input', 
    data: { 
      label: 'Image Input',
      type: 'input',
      llmSettings: {
        modelName: 'gpt-3.5-turbo',
        temperature: 0.7,
        maxTokens: 100,
      },
      agentConfig: {
        role: 'Image Input Processor',
        capabilities: 'Process and prepare image data for further analysis',
      },
    }, 
    position: { x: 0, y: 50 } 
  },
  { 
    id: 'model2', 
    data: { 
      label: 'Image Processing',
      type: 'processing',
      llmSettings: {
        modelName: 'gpt-4',
        temperature: 0.5,
        maxTokens: 200,
      },
      agentConfig: {
        role: 'Image Analyzer',
        capabilities: 'Analyze and extract features from images',
      },
    }, 
    position: { x: 200, y: 50 } 
  },
  { 
    id: 'model3', 
    data: { 
      label: 'Text Generation',
      type: 'generation',
      llmSettings: {
        modelName: 'gpt-4',
        temperature: 0.8,
        maxTokens: 300,
      },
      agentConfig: {
        role: 'Text Generator',
        capabilities: 'Generate descriptive text based on image analysis',
      },
    }, 
    position: { x: 400, y: 50 } 
  },
  { 
    id: 'model4', 
    type: 'output', 
    data: { 
      label: 'Output',
      type: 'output',
      llmSettings: {
        modelName: 'gpt-3.5-turbo',
        temperature: 0.6,
        maxTokens: 150,
      },
      agentConfig: {
        role: 'Output Formatter',
        capabilities: 'Format and prepare final output for presentation',
      },
    }, 
    position: { x: 600, y: 50 } 
  },
];

const initialEdges = [
  { id: 'e1-2', source: 'model1', target: 'model2' },
  { id: 'e2-3', source: 'model2', target: 'model3' },
  { id: 'e3-4', source: 'model3', target: 'model4' },
];

const ModelCallDiagram = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
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