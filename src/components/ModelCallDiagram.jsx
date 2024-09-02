import React from 'react';
import ReactFlow, { Background, Controls, MiniMap } from 'react-flow-renderer';

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
  return (
    <div style={{ width: '100%', height: '600px' }}>
      <ReactFlow
        nodes={initialNodes}
        edges={initialEdges}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
};

export default ModelCallDiagram;