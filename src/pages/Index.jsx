import React from 'react';
import ModelCallDiagram from '../components/ModelCallDiagram';
import { ThemeToggle } from '../components/ThemeToggle';

const Index = () => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-background text-foreground">
      <div className="w-full p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Model Call Relationship Diagram</h1>
        <ThemeToggle />
      </div>
      <div className="w-full h-[calc(100%-5rem)] bg-card rounded-lg shadow-lg overflow-hidden">
        <ModelCallDiagram />
      </div>
    </div>
  );
};

export default Index;