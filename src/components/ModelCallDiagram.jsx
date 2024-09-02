import React, { useCallback, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
} from 'react-flow-renderer';
import 'react-flow-renderer/dist/style.css';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialNodes = [
  { id: 'model1', type: 'input', data: { label: 'Image Input' }, position: { x: 0, y: 50 } },
  { id: 'model2', data: { label: 'Image Processing' }, position: { x: 200, y: 50 } },
  { id: 'model3', data: { label: 'Text Generation' }, position: { x: 400, y: 50 } },
  { id: 'model4', type: 'output', data: { label: 'Output' }, position: { x: 600, y: 50 } },
];

const initialEdges = [
  { id: 'e1-2', source: 'model1', target: 'model2' },
  { id: 'e2-3', source: 'model2', target: 'model3' },
  { id: 'e3-4', source: 'model3', target: 'model4' },
];

const ModelCallDiagram = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [nodeName, setNodeName] = useState('');

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const addNode = useCallback(() => {
    const newNode = {
      id: `node-${nodes.length + 1}`,
      data: { label: nodeName || `Node ${nodes.length + 1}` },
      position: { x: Math.random() * 500, y: Math.random() * 500 },
    };
    setNodes((nds) => nds.concat(newNode));
    setNodeName('');
  }, [nodes, nodeName, setNodes]);

  const saveGraph = useCallback(() => {
    const graphData = { nodes, edges };
    localStorage.setItem('savedGraph', JSON.stringify(graphData));
    alert('Graph saved successfully!');
  }, [nodes, edges]);

  const loadGraph = useCallback(() => {
    const savedGraph = localStorage.getItem('savedGraph');
    if (savedGraph) {
      const { nodes: savedNodes, edges: savedEdges } = JSON.parse(savedGraph);
      setNodes(savedNodes);
      setEdges(savedEdges);
      alert('Graph loaded successfully!');
    } else {
      alert('No saved graph found!');
    }
  }, [setNodes, setEdges]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      <div className="absolute top-4 left-4 z-10 bg-white p-4 rounded-lg shadow-md">
        <div className="flex flex-col gap-2">
          <Input
            type="text"
            value={nodeName}
            onChange={(e) => setNodeName(e.target.value)}
            placeholder="Enter node name"
            className="w-48"
          />
          <Button onClick={addNode} className="w-48">Add Node</Button>
          <Button onClick={saveGraph} className="w-48">Save Graph</Button>
          <Button onClick={loadGraph} className="w-48">Load Graph</Button>
        </div>
      </div>
    </div>
  );
};

export default ModelCallDiagram;