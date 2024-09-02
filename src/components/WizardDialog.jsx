import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const WizardDialog = ({ onAddNode }) => {
  const [step, setStep] = useState(1);
  const [nodeData, setNodeData] = useState({
    name: '',
    type: '',
    llmSettings: {
      modelName: '',
      temperature: 0.7,
      maxTokens: 100,
    },
    agentConfig: {
      role: '',
      capabilities: '',
    },
    tools: [],
  });

  const handleInputChange = (category, field, value) => {
    setNodeData(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [field]: value
      }
    }));
  };

  const handleNext = () => setStep(prev => prev + 1);
  const handleBack = () => setStep(prev => prev - 1);

  const handleFinish = () => {
    onAddNode(nodeData);
    setStep(1);
    setNodeData({
      name: '',
      type: '',
      llmSettings: {
        modelName: '',
        temperature: 0.7,
        maxTokens: 100,
      },
      agentConfig: {
        role: '',
        capabilities: '',
      },
      tools: [],
    });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Add Node</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add New Node - Step {step}</DialogTitle>
        </DialogHeader>
        {step === 1 && (
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">Name</Label>
              <Input
                id="name"
                value={nodeData.name}
                onChange={(e) => setNodeData(prev => ({ ...prev, name: e.target.value }))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="type" className="text-right">Type</Label>
              <Input
                id="type"
                value={nodeData.type}
                onChange={(e) => setNodeData(prev => ({ ...prev, type: e.target.value }))}
                className="col-span-3"
              />
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="modelName" className="text-right">Model Name</Label>
              <Select
                onValueChange={(value) => handleInputChange('llmSettings', 'modelName', value)}
                defaultValue={nodeData.llmSettings.modelName}
              >
                <SelectTrigger className="col-span-3">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                  <SelectItem value="gpt-4">GPT-4</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="temperature" className="text-right">Temperature</Label>
              <Input
                id="temperature"
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={nodeData.llmSettings.temperature}
                onChange={(e) => handleInputChange('llmSettings', 'temperature', parseFloat(e.target.value))}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="maxTokens" className="text-right">Max Tokens</Label>
              <Input
                id="maxTokens"
                type="number"
                value={nodeData.llmSettings.maxTokens}
                onChange={(e) => handleInputChange('llmSettings', 'maxTokens', parseInt(e.target.value))}
                className="col-span-3"
              />
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="role" className="text-right">Role</Label>
              <Input
                id="role"
                value={nodeData.agentConfig.role}
                onChange={(e) => handleInputChange('agentConfig', 'role', e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="capabilities" className="text-right">Capabilities</Label>
              <Textarea
                id="capabilities"
                value={nodeData.agentConfig.capabilities}
                onChange={(e) => handleInputChange('agentConfig', 'capabilities', e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>
        )}
        <div className="flex justify-between mt-4">
          {step > 1 && <Button onClick={handleBack}>Back</Button>}
          {step < 3 ? (
            <Button onClick={handleNext}>Next</Button>
          ) : (
            <Button onClick={handleFinish}>Finish</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WizardDialog;