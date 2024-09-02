import React, { useRef, useEffect } from 'react';
import RelationGraph from 'relation-graph';
import 'relation-graph/dist/relation-graph.min.css';
import './ModelCallDiagram.css';

const ModelCallDiagram = () => {
  const graphRef = useRef(null);

  useEffect(() => {
    const graphData = {
      nodes: [
        { id: 'model1', text: 'Image Input', category: 'input' },
        { id: 'model2', text: 'Image Processing', category: 'process' },
        { id: 'model3', text: 'Text Generation', category: 'process' },
        { id: 'model4', text: 'Output', category: 'output' }
      ],
      lines: [
        { from: 'model1', to: 'model2' },
        { from: 'model2', to: 'model3' },
        { from: 'model3', to: 'model4' }
      ]
    };

    const nodeTemplate = (node) => {
      const colors = {
        input: '#4CAF50',
        process: '#2196F3',
        output: '#FFC107'
      };
      
      return `
        <div style="background-color: ${colors[node.category]}; padding: 10px; border-radius: 5px;">
          <strong>${node.text}</strong>
        </div>
      `;
    };

    const graph = new RelationGraph({
      container: graphRef.current,
      data: graphData,
      layout: {
        type: 'dagre',
        rankdir: 'LR',
        nodesep: 50,
        ranksep: 100
      },
      defaultNodeWidth: 150,
      defaultNodeHeight: 60,
      nodeTemplate: nodeTemplate,
      enableZoom: true,
      enablePan: true
    });

    graph.render();

    graph.on('node-click', (node) => {
      console.log('Node clicked:', node);
      // Implement node selection logic
    });

    graph.on('line-click', (line) => {
      console.log('Edge clicked:', line);
      // Implement edge selection logic
    });

    return () => {
      graph.destroy();
    };
  }, []);

  return <div ref={graphRef} style={{width: '100%', height: '600px'}} />;
};

export default ModelCallDiagram;