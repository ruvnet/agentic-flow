import React from 'react';
import ModelCallDiagram from '../components/ModelCallDiagram';

const Index = () => {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100">
      <h1 className="text-4xl font-bold mb-4">Model Call Relationship Diagram</h1>
      <div className="w-full max-w-6xl bg-white p-6 rounded-lg shadow-lg">
        <ModelCallDiagram />
      </div>
    </div>
  );
};

export default Index;