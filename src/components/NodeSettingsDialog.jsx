import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NodeSettingsDialog = ({ node, onSave, onDelete }) => {
  const [nodeData, setNodeData] = useState({
    label: '',
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
  });

  useEffect(() => {
    if (node && node.data) {
      setNodeData({
        label: node.data.label || '',
        type: node.data.type || '',
        llmSettings: {
          modelName: node.data.llmSettings?.modelName || '',
          temperature: node.data.llmSettings?.temperature || 0.7,
          maxTokens: node.data.llmSettings?.maxTokens || 100,
        },
        agentConfig: {
          role: node.data.agentConfig?.role || '',
          capabilities: node.data.agentConfig?.capabilities || '',
        },
      });
    }
  }, [node]);

  const handleInputChange = (category, field, value) => {
    setNodeData(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [field]: value
      }
    }));
  };

  const handleSave = () => {
    onSave(node.id, nodeData);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Edit Node</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Node Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">Name</Label>
            <Input
              id="name"
              value={nodeData.label}
              onChange={(e) => setNodeData(prev => ({ ...prev, label: e.target.value }))}
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
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="modelName" className="text-right">Model Name</Label>
            <Select
              onValueChange={(value) => handleInputChange('llmSettings', 'modelName', value)}
              value={nodeData.llmSettings.modelName}
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
        <div className="flex justify-between mt-4">
          <Button onClick={onDelete} variant="destructive">Delete Node</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NodeSettingsDialog;