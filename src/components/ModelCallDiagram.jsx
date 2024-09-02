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
import AgenticFlowWizard from './AgenticFlowWizard';

const ModelCallDiagram = () => {
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

  const createAgenticFlow = (flowConfig) => {
    const baseX = Math.random() * 300;
    const baseY = Math.random() * 300;
    const newNodes = [];
    const newEdges = [];

    switch (flowConfig.type) {
      case "Data Preprocessing":
        newNodes.push(
          { id: `${flowConfig.name}-input`, data: { label: 'Raw Data', type: 'input' }, position: { x: baseX, y: baseY } },
          { id: `${flowConfig.name}-clean`, data: { label: 'Data Cleaning', type: 'process' }, position: { x: baseX + 150, y: baseY - 50 } },
          { id: `${flowConfig.name}-transform`, data: { label: 'Data Transformation', type: 'process' }, position: { x: baseX + 150, y: baseY + 50 } },
          { id: `${flowConfig.name}-output`, data: { label: 'Processed Data', type: 'output' }, position: { x: baseX + 300, y: baseY } }
        );
        newEdges.push(
          { id: `${flowConfig.name}-e1`, source: `${flowConfig.name}-input`, target: `${flowConfig.name}-clean` },
          { id: `${flowConfig.name}-e2`, source: `${flowConfig.name}-input`, target: `${flowConfig.name}-transform` },
          { id: `${flowConfig.name}-e3`, source: `${flowConfig.name}-clean`, target: `${flowConfig.name}-output` },
          { id: `${flowConfig.name}-e4`, source: `${flowConfig.name}-transform`, target: `${flowConfig.name}-output` }
        );
        break;
      case "Model Execution":
        newNodes.push(
          { id: `${flowConfig.name}-input`, data: { label: 'Input Data', type: 'input' }, position: { x: baseX, y: baseY } },
          { id: `${flowConfig.name}-model`, data: { label: 'AI Model', type: 'process' }, position: { x: baseX + 150, y: baseY } },
          { id: `${flowConfig.name}-interpret`, data: { label: 'Result Interpretation', type: 'process' }, position: { x: baseX + 300, y: baseY } },
          { id: `${flowConfig.name}-output`, data: { label: 'Final Output', type: 'output' }, position: { x: baseX + 450, y: baseY } }
        );
        newEdges.push(
          { id: `${flowConfig.name}-e1`, source: `${flowConfig.name}-input`, target: `${flowConfig.name}-model` },
          { id: `${flowConfig.name}-e2`, source: `${flowConfig.name}-model`, target: `${flowConfig.name}-interpret` },
          { id: `${flowConfig.name}-e3`, source: `${flowConfig.name}-interpret`, target: `${flowConfig.name}-output` }
        );
        break;
      case "Conditional Branching":
        newNodes.push(
          { id: `${flowConfig.name}-input`, data: { label: 'Input', type: 'input' }, position: { x: baseX, y: baseY } },
          { id: `${flowConfig.name}-condition`, data: { label: 'Condition Check', type: 'process' }, position: { x: baseX + 150, y: baseY } },
          { id: `${flowConfig.name}-branch1`, data: { label: 'Branch 1', type: 'process' }, position: { x: baseX + 300, y: baseY - 75 } },
          { id: `${flowConfig.name}-branch2`, data: { label: 'Branch 2', type: 'process' }, position: { x: baseX + 300, y: baseY + 75 } },
          { id: `${flowConfig.name}-output`, data: { label: 'Output', type: 'output' }, position: { x: baseX + 450, y: baseY } }
        );
        newEdges.push(
          { id: `${flowConfig.name}-e1`, source: `${flowConfig.name}-input`, target: `${flowConfig.name}-condition` },
          { id: `${flowConfig.name}-e2`, source: `${flowConfig.name}-condition`, target: `${flowConfig.name}-branch1` },
          { id: `${flowConfig.name}-e3`, source: `${flowConfig.name}-condition`, target: `${flowConfig.name}-branch2` },
          { id: `${flowConfig.name}-e4`, source: `${flowConfig.name}-branch1`, target: `${flowConfig.name}-output` },
          { id: `${flowConfig.name}-e5`, source: `${flowConfig.name}-branch2`, target: `${flowConfig.name}-output` }
        );
        break;
      // Add more cases for other flow types
      default:
        newNodes.push(
          { id: `${flowConfig.name}-generic`, data: { label: flowConfig.name, type: 'default' }, position: { x: baseX, y: baseY } }
        );
    }

    setNodes(newNodes);
    setEdges(newEdges);
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
          <AgenticFlowWizard onCreateFlow={createAgenticFlow} onClearDiagram={clearDiagram} />
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