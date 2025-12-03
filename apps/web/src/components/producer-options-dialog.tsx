"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";

interface ProducerOptionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantSlug: string;
  tenantName: string;
  producerType: "gutenberg" | "s3" | "govdocs";
  producerName: string;
  onTrigger: (options: { checkExisting: boolean; forceReindex: boolean; fetchNew?: number }) => Promise<void>;
  triggering: boolean;
}

export function ProducerOptionsDialog({
  open,
  onOpenChange,
  tenantSlug,
  tenantName,
  producerType,
  producerName,
  onTrigger,
  triggering,
}: ProducerOptionsDialogProps) {
  const [checkExisting, setCheckExisting] = useState(false);
  const [forceReindex, setForceReindex] = useState(false);
  const [fetchNew, setFetchNew] = useState(false);
  const [newDocumentCount, setNewDocumentCount] = useState("10");
  const isGutenberg = producerType === "gutenberg";

  const handleSubmit = async () => {
    if (!checkExisting && !forceReindex && !fetchNew) {
      return; // At least one option must be selected
    }

    if (fetchNew) {
      const count = parseInt(newDocumentCount, 10);
      if (isNaN(count) || count <= 0) {
        return; // Invalid count
      }
      await onTrigger({ checkExisting, forceReindex, fetchNew: count });
    } else {
      await onTrigger({ checkExisting, forceReindex });
    }
  };

  const handleClose = () => {
    if (!triggering) {
      setCheckExisting(false);
      setForceReindex(false);
      setFetchNew(false);
      setNewDocumentCount("10");
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Run Indexing</DialogTitle>
          <DialogDescription>
            Configure how the producer should process documents for the{" "}
            <strong>{tenantName}</strong> tenant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Check Existing Documents Option */}
          <div className={`flex items-start space-x-3 p-4 border rounded-lg ${isGutenberg ? 'opacity-60' : ''}`}>
            <Checkbox
              id="check-existing"
              checked={checkExisting}
              onCheckedChange={(checked) => setCheckExisting(checked === true)}
              disabled={triggering || isGutenberg}
            />
            <div className="flex-1 space-y-1">
              <Label
                htmlFor="check-existing"
                className={`text-sm font-medium leading-none ${isGutenberg ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
              >
                Check existing documents
              </Label>
              <p className="text-xs text-muted-foreground">
                {isGutenberg ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    Gutenberg content is static and never changes. This option is not available for Gutenberg.
                  </span>
                ) : (
                  "Scan manifest entries to detect changes in already-indexed documents. This will reindex documents that have been modified since last indexing."
                )}
              </p>
            </div>
          </div>

          {/* Force Reindex Existing Documents Option */}
          <div className="flex items-start space-x-3 p-4 border rounded-lg border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20">
            <Checkbox
              id="force-reindex"
              checked={forceReindex}
              onCheckedChange={(checked) => setForceReindex(checked === true)}
              disabled={triggering}
            />
            <div className="flex-1 space-y-1">
              <Label
                htmlFor="force-reindex"
                className="text-sm font-medium leading-none cursor-pointer"
              >
                Force reindex all existing documents
              </Label>
              <p className="text-xs text-muted-foreground">
                <span className="text-amber-600 dark:text-amber-400 font-medium">Warning:</span> This will reindex all documents in the manifest, regardless of whether they have changed. This can be time-consuming and resource-intensive.
              </p>
            </div>
          </div>

          {/* Fetch New Documents Option */}
          <div className="flex items-start space-x-3 p-4 border rounded-lg">
            <Checkbox
              id="fetch-new"
              checked={fetchNew}
              onCheckedChange={(checked) => setFetchNew(checked === true)}
              disabled={triggering}
            />
            <div className="flex-1 space-y-2">
              <Label
                htmlFor="fetch-new"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Add new documents
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Fetch and index new documents from the source. Specify how many documents to
                process.
              </p>
              {fetchNew && (
                <div className="space-y-2">
                  <Label htmlFor="document-count" className="text-xs">
                    Number of documents
                  </Label>
                  <Input
                    id="document-count"
                    type="number"
                    min="1"
                    value={newDocumentCount}
                    onChange={(e) => setNewDocumentCount(e.target.value)}
                    disabled={triggering}
                    className="w-32"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={triggering}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={triggering || (!checkExisting && !forceReindex && !fetchNew)}
          >
            {triggering ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              "Run Indexing"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

