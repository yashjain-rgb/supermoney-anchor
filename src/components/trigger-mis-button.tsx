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
      const response = await fetch(`/api/run-mis-task?test=${isTest}`, {
          method: 'POST'
      });
      
      const text = await response.text();
      let result;
      
      try {
        result = JSON.parse(text);
      } catch (e) {
        // Fallback for non-JSON error responses (like raw server crashes or HTML errors)
        result = { error: text || "Server returned an empty or invalid response." };
      }

      if (response.ok) {
        toast({
          title: "MIS Triggered",
          description: result.message || "The MIS report generation has started.",
        });
      } else {
        // Construct detailed error message from server response
        const errorMsg = result.details ? `${result.error}: ${result.details}` : (result.error || "Unknown Server Error");
        throw new Error(errorMsg);
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