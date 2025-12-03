"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";

interface CacheDumpButtonProps {
  onDumped?: () => void;
}

export function CacheDumpButton({ onDumped }: CacheDumpButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState("all");
  const [availableTenants, setAvailableTenants] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingTenants, setFetchingTenants] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const fetchTenants = async () => {
    setFetchingTenants(true);
    try {
      const response = await fetch("/api/tenants/accessible");
      if (response.ok) {
        const data = await response.json();
        const tenants = data.tenants?.map((t: { slug: string }) => t.slug) || [];
        setAvailableTenants(tenants);
      }
    } catch (error) {
      console.error("Error fetching tenants:", error);
    } finally {
      setFetchingTenants(false);
    }
  };

  const handleOpenDialog = () => {
    fetchTenants();
    setDialogOpen(true);
  };

  const handleDumpCache = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/cache?tenant=${encodeURIComponent(selectedTenant)}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to dump cache");
      }

      const data = await response.json();
      
      toast({
        title: "Cache dumped",
        description: data.message || `Deleted ${data.deleted || 0} cache entries.`,
      });

      setDialogOpen(false);
      setSelectedTenant("all");
      
      if (onDumped) {
        onDumped();
      } else {
        router.refresh();
      }
    } catch (error) {
      console.error("Error dumping cache:", error);
      toast({
        title: "Failed to dump cache",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        onClick={handleOpenDialog}
        className="flex items-center gap-2"
      >
        <Trash2 className="h-4 w-4" />
        Dump Cache
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dump Cache</DialogTitle>
            <DialogDescription>
              This will permanently delete cache entries. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-select">Select Tenant</Label>
              <Select
                value={selectedTenant}
                onValueChange={setSelectedTenant}
                disabled={loading || fetchingTenants}
              >
                <SelectTrigger id="tenant-select" className="bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tenants</SelectItem>
                  {availableTenants.map((tenant) => (
                    <SelectItem key={tenant} value={tenant}>
                      {tenant}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedTenant === "all"
                  ? "This will delete all cache entries for all tenants."
                  : `This will delete all cache entries for tenant "${selectedTenant}".`}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                setSelectedTenant("all");
              }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDumpCache}
              disabled={loading || fetchingTenants}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Dumping...
                </>
              ) : (
                "Dump Cache"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

