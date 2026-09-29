
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, MailCheck, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function TriggerMisButton() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleTrigger = async (isTest: boolean) => {
    setIsLoading(true);
    try {
      // In production, the client doesn't know the DEALER_API_SECRET_KEY.
      // We'll call a simple server action or endpoint wrapper that injects it.
      const response = await fetch(`/api/run-mis-task?test=${isTest}`, {
          method: 'POST'
      });
      
      const result = await response.json();

      if (response.ok) {
        toast({
          title: "MIS Triggered",
          description: result.message || "The MIS report generation has started.",
        });
      } else {
        throw new Error(result.error || "Failed to trigger MIS");
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Trigger Failed",
        description: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex gap-2">
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => handleTrigger(true)} 
        disabled={isLoading}
        className="bg-primary/5 border-primary/20 text-primary hover:bg-primary/10"
      >
        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailCheck className="mr-2 h-4 w-4" />}
        Test MIS (Yash)
      </Button>
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => handleTrigger(false)} 
        disabled={isLoading}
      >
        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
        Run Full MIS
      </Button>
    </div>
  );
}
