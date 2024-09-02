import React from 'react';
import ModelCallDiagram from '../components/ModelCallDiagram';

const Index = () => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100">
      <h1 className="text-2xl font-bold mb-4">Model Call Relationship Diagram</h1>
      <div className="w-full h-[calc(100%-4rem)] bg-white rounded-lg shadow-lg overflow-hidden">
        <ModelCallDiagram />
      </div>
    </div>
  );
};

export default Index;