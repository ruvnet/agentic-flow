import React, { useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { FiSettings, FiCpu, FiCode, FiDatabase, FiFile } from 'react-icons/fi';

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

const initialNodes = [
  {
    id: '1',
    type: 'custom',
    position: { x: 0, y: 0 },
    data: { label: 'LLM Provider', description: 'Select the LLM provider', icon: <FiDatabase className="text-blue-500" /> },
  },
  {
    id: '2',
    type: 'custom',
    position: { x: 250, y: 0 },
    data: { label: 'Model Selection', description: 'Choose the LLM model', icon: <FiCpu className="text-green-500" /> },
  },
  {
    id: '3',
    type: 'custom',
    position: { x: 500, y: 0 },
    data: { label: 'Prompt Engineering', description: 'Configure prompt settings', icon: <FiCode className="text-purple-500" /> },
  },
  {
    id: '4',
    type: 'custom',
    position: { x: 750, y: 0 },
    data: { label: 'API Settings', description: 'Set API parameters', icon: <FiSettings className="text-yellow-500" /> },
  },
  {
    id: '5',
    type: 'custom',
    position: { x: 1000, y: 0 },
    data: { label: 'Output', description: 'Generated output from LLM', icon: <FiFile className="text-red-500" /> },
  },
];

const initialEdges = [
  { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: 'url(#edge-gradient)' } },
  { id: 'e2-3', source: '2', target: '3', animated: true, style: { stroke: 'url(#edge-gradient)' } },
  { id: 'e3-4', source: '3', target: '4', animated: true, style: { stroke: 'url(#edge-gradient)' } },
  { id: 'e4-5', source: '4', target: '5', animated: true, style: { stroke: 'url(#edge-gradient)' } },
];

const ModelCallDiagram = ({ onExportJson }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  React.useEffect(() => {
    onExportJson({ nodes, edges });
  }, [nodes, edges, onExportJson]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background variant="dots" gap={12} size={1} />
        <Controls />
        <MiniMap />
        <svg width="0" height="0">
          <defs>
            <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ff00ff" />
              <stop offset="50%" stopColor="#00ffff" />
              <stop offset="100%" stopColor="#ff00ff" />
            </linearGradient>
          </defs>
        </svg>
      </ReactFlow>
    </div>
  );
};

export default ModelCallDiagram;