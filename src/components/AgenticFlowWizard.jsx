import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const flowTypes = [
  "Data Preprocessing",
  "Model Execution",
  "Conditional Branching",
  "Iterative Processing",
  "Parallel Processing",
  "Data Fusion",
  "Feedback Loops",
  "Pipeline Orchestration",
  "Interactive Query",
  "Output Generation"
];

const AgenticFlowWizard = ({ onCreateFlow, onClearDiagram, onSaveFlow }) => {
  const [step, setStep] = useState(1);
  const [flowType, setFlowType] = useState('');
  const [flowName, setFlowName] = useState('');
  const [flowDescription, setFlowDescription] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  const handleNext = () => setStep(prev => prev + 1);
  const handleBack = () => setStep(prev => prev - 1);

  const handleCreate = () => {
    setShowSavePrompt(true);
  };

  const proceedWithCreation = () => {
    onCreateFlow({ type: flowType, name: flowName, description: flowDescription });
    resetForm();
  };

  const resetForm = () => {
    setStep(1);
    setFlowType('');
    setFlowName('');
    setFlowDescription('');
    setIsOpen(false);
    setShowSavePrompt(false);
  };

  const handleClearDiagram = () => {
    if (window.confirm("Are you sure you want to clear the current diagram? You can save it before clearing.")) {
      onClearDiagram();
      resetForm();
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button onClick={() => setIsOpen(true)}>New Agentic Flow</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Agentic Flow - Step {step}</DialogTitle>
          </DialogHeader>
          {step === 1 && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="flowType" className="text-right">Flow Type</Label>
                <Select onValueChange={setFlowType} value={flowType}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select flow type" />
                  </SelectTrigger>
                  <SelectContent>
                    {flowTypes.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="flowName" className="text-right">Flow Name</Label>
                <Input
                  id="flowName"
                  value={flowName}
                  onChange={(e) => setFlowName(e.target.value)}
                  className="col-span-3"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="flowDescription" className="text-right">Description</Label>
                <Textarea
                  id="flowDescription"
                  value={flowDescription}
                  onChange={(e) => setFlowDescription(e.target.value)}
                  className="col-span-3"
                />
              </div>
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

      <AlertDialog open={showSavePrompt} onOpenChange={setShowSavePrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save Current Flow?</AlertDialogTitle>
            <AlertDialogDescription>
              Do you want to save the current flow before creating a new one?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => proceedWithCreation()}>No, Create New</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onSaveFlow(); proceedWithCreation(); }}>Yes, Save and Create</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default AgenticFlowWizard;