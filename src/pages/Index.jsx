import React, { useState, useCallback } from 'react';
import ModelCallDiagram from '../components/ModelCallDiagram';
import { ThemeToggle } from '../components/ThemeToggle';
import { Button } from "@/components/ui/button";
import JSONModal from '../components/JSONModal';
import { Toaster } from "@/components/ui/toaster";

const Index = () => {
  const [jsonData, setJsonData] = useState(null);
  const [isJSONModalOpen, setIsJSONModalOpen] = useState(false);

  const handleExportToJson = useCallback(() => {
    if (jsonData) {
      setIsJSONModalOpen(true);
    }
  }, [jsonData]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-background text-foreground">
      <div className="w-full p-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Agentic Flow</h1>
        <div className="flex items-center space-x-4">
          <Button onClick={handleExportToJson}>Export to JSON</Button>
          <ThemeToggle />
        </div>
      </div>
      <div className="w-full h-[calc(100%-5rem)] bg-card rounded-lg shadow-lg overflow-hidden">
        <ModelCallDiagram onExportJson={setJsonData} />
      </div>
      <JSONModal
        isOpen={isJSONModalOpen}
        onClose={() => setIsJSONModalOpen(false)}
        jsonData={jsonData}
      />
      <Toaster />
    </div>
  );
};

export default Index;