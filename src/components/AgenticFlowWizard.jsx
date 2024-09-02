import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

const flowTypes = [
  { name: "Image Input -> Resize", complexity: "simple" },
  { name: "Text Prompt -> Embedding", complexity: "simple" },
  { name: "Model Selection -> Inference", complexity: "simple" },
  { name: "Image Processing Pipeline", complexity: "medium" },
  { name: "Text Generation Flow", complexity: "medium" },
  { name: "Data Augmentation Sequence", complexity: "medium" },
  { name: "Advanced Image Generation", complexity: "complex" },
  { name: "Multi-Modal AI Pipeline", complexity: "complex" },
  { name: "Iterative Optimization Flow", complexity: "complex" },
];

const AgenticFlowWizard = ({ onCreateFlow, onClearDiagram }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [flowConfig, setFlowConfig] = useState({
    type: '',
    name: '',
    parameters: {},
  });

  const handleNext = () => setStep(prev => prev + 1);
  const handleBack = () => setStep(prev => prev - 1);

  const handleCreate = () => {
    onCreateFlow(flowConfig);
    resetForm();
  };

  const resetForm = () => {
    setStep(1);
    setFlowConfig({
      type: '',
      name: '',
      parameters: {},
    });
    setIsOpen(false);
  };

  const handleClearDiagram = () => {
    if (window.confirm("Are you sure you want to clear the current diagram? You can save it before clearing.")) {
      onClearDiagram();
      resetForm();
    }
  };

  const renderParameters = () => {
    switch (flowConfig.type) {
      case "Image Input -> Resize":
        return (
          <>
            <Label>Image Dimensions</Label>
            <Input
              type="number"
              placeholder="Width"
              onChange={(e) => setFlowConfig(prev => ({ ...prev, parameters: { ...prev.parameters, width: e.target.value } }))}
            />
            <Input
              type="number"
              placeholder="Height"
              onChange={(e) => setFlowConfig(prev => ({ ...prev, parameters: { ...prev.parameters, height: e.target.value } }))}
            />
          </>
        );
      case "Text Prompt -> Embedding":
        return (
          <>
            <Label>Embedding Model</Label>
            <Select onValueChange={(value) => setFlowConfig(prev => ({ ...prev, parameters: { ...prev.parameters, model: value } }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bert">BERT</SelectItem>
                <SelectItem value="gpt">GPT</SelectItem>
                <SelectItem value="word2vec">Word2Vec</SelectItem>
              </SelectContent>
            </Select>
          </>
        );
      case "Model Selection -> Inference":
        return (
          <>
            <Label>Model Architecture</Label>
            <Select onValueChange={(value) => setFlowConfig(prev => ({ ...prev, parameters: { ...prev.parameters, architecture: value } }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select architecture" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cnn">CNN</SelectItem>
                <SelectItem value="transformer">Transformer</SelectItem>
                <SelectItem value="rnn">RNN</SelectItem>
              </SelectContent>
            </Select>
            <Label>Inference Device</Label>
            <Select onValueChange={(value) => setFlowConfig(prev => ({ ...prev, parameters: { ...prev.parameters, device: value } }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select device" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cpu">CPU</SelectItem>
                <SelectItem value="gpu">GPU</SelectItem>
              </SelectContent>
            </Select>
          </>
        );
      // Add cases for medium and complex flows here
      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button onClick={handleClearDiagram}>New Agentic Flow</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Agentic Flow - Step {step}</DialogTitle>
        </DialogHeader>
        {step === 1 && (
          <div className="grid gap-4 py-4">
            <Label>Flow Type</Label>
            <Select onValueChange={(value) => setFlowConfig(prev => ({ ...prev, type: value }))}>
              <SelectTrigger>
                <SelectValue placeholder="Select flow type" />
              </SelectTrigger>
              <SelectContent>
                {flowTypes.map((flow) => (
                  <SelectItem key={flow.name} value={flow.name}>{flow.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-4 py-4">
            <Label>Flow Name</Label>
            <Input
              value={flowConfig.name}
              onChange={(e) => setFlowConfig(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter flow name"
            />
            {renderParameters()}
          </div>
        )}
        <div className="flex justify-between mt-4">
          {step > 1 && <Button onClick={handleBack}>Back</Button>}
          {step < 2 ? (
            <Button onClick={handleNext}>Next</Button>
          ) : (
            <Button onClick={handleCreate}>Create Flow</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AgenticFlowWizard;