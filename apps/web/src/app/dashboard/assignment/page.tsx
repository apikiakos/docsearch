"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "next-themes";
import { PageHeader } from "@/components/page-header";

type DocFile = {
  filename: string;
  name: string;
};

type MarkdownViewerProps = {
  content: string;
  theme: string | undefined;
  onChangeTab: (filename: string) => void;
  files: DocFile[];
};

// Separate component for markdown viewer with changeTab prop
function MarkdownViewer({ content, theme, onChangeTab, files }: MarkdownViewerProps) {
  // Helper function to find markdown file from href
  const findMarkdownFile = useCallback((href: string): string | null => {
    if (!href) return null;
    
    // Decode URL encoding (e.g., %20 -> space)
    const decodedHref = decodeURIComponent(href);
    
    // Remove leading ./ or ./
    const normalizedHref = decodedHref.replace(/^\.\//, '').replace(/^\//, '');
    
    // Extract filename from href (handles ./filename.md, filename.md, path/filename.md, etc.)
    let filename = normalizedHref.split('/').pop() || normalizedHref;
    
    // Remove query params and hash
    filename = filename.split('?')[0].split('#')[0];
    
    // Try to find exact match first (with or without .md extension)
    const exactMatch = files.find(file => {
      const normalizedFilename = file.filename.toLowerCase();
      const normalizedName = file.name.toLowerCase();
      const normalizedHrefLower = filename.toLowerCase();
      
      // Exact filename match
      if (normalizedFilename === normalizedHrefLower) return true;
      // Filename without .md extension
      if (normalizedFilename === normalizedHrefLower + '.md') return true;
      // Name match (without .md)
      if (normalizedName === normalizedHrefLower.replace(/\.md$/, '')) return true;
      // Name with .md
      if (normalizedName + '.md' === normalizedHrefLower) return true;
      
      return false;
    });
    
    if (exactMatch) {
      return exactMatch.filename;
    }
    
    // Try partial match (filename contains the href or vice versa)
    const partialMatch = files.find(file => {
      const normalizedFilename = file.filename.toLowerCase();
      const normalizedName = file.name.toLowerCase();
      const normalizedHrefLower = filename.toLowerCase();
      
      // Check if filename contains href or href contains filename
      return (
        normalizedFilename.includes(normalizedHrefLower.replace(/\.md$/, '')) ||
        normalizedHrefLower.includes(normalizedFilename.replace(/\.md$/, '')) ||
        normalizedName.includes(normalizedHrefLower.replace(/\.md$/, '')) ||
        normalizedHrefLower.includes(normalizedName)
      );
    });
    
    return partialMatch ? partialMatch.filename : null;
  }, [files]);

  // Ref for the markdown content div
  const contentRef = useRef<HTMLDivElement>(null);

  // Scroll to top when content changes
  useEffect(() => {
    // Use setTimeout to ensure DOM is updated
    const timer = setTimeout(() => {
      if (contentRef.current) {
        // Find the ScrollArea viewport by traversing up the DOM tree
        let parent = contentRef.current.parentElement;
        while (parent) {
          const viewport = parent.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement;
          if (viewport) {
            viewport.scrollTop = 0;
            break;
          }
          parent = parent.parentElement;
        }
      }
    }, 0);
    
    return () => clearTimeout(timer);
  }, [content]);

  // Intercept all clicks on markdown links at the container level
  // Use MutationObserver to catch links as they're added to DOM
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Process all markdown links - convert <a> to <span> to prevent navigation
    const processLinks = () => {
      const links = container.querySelectorAll('a[href]');
      links.forEach((linkEl) => {
        const link = linkEl as HTMLAnchorElement;
        const href = link.getAttribute('href');
        if (href && !link.hasAttribute('data-markdown-processed')) {
          // Try to decode the href in case it's URL-encoded
          let decodedHref = href;
          try {
            decodedHref = decodeURIComponent(href);
          } catch {
            // If decoding fails, use original
          }
          const markdownFile = findMarkdownFile(decodedHref) || findMarkdownFile(href);
          if (markdownFile) {
            // Mark as processed to avoid re-processing
            link.setAttribute('data-markdown-processed', 'true');
            
            // Convert <a> to <span> to completely prevent navigation
            const parent = link.parentNode;
            if (parent) {
              const span = document.createElement('span');
              span.setAttribute('data-markdown-link', markdownFile);
              span.setAttribute('role', 'link');
              span.setAttribute('tabIndex', '0');
              span.className = link.className || 'text-primary underline hover:text-primary/80 cursor-pointer';
              span.style.cursor = 'pointer';
              span.style.textDecoration = 'underline';
              span.innerHTML = link.innerHTML;
              
              // Add click handler
              const clickHandler = (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                onChangeTab(markdownFile);
                return false;
              };
              span.addEventListener('click', clickHandler, true);
              
              // Handle keyboard
              span.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChangeTab(markdownFile);
                }
              });
              
              // Replace the anchor with span
              parent.replaceChild(span, link);
            }
          }
        }
      });
    };

    // Process links immediately and after a short delay
    processLinks();
    const timer1 = setTimeout(processLinks, 100);
    const timer2 = setTimeout(processLinks, 500);

    // Use MutationObserver to catch links as they're added
    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          shouldProcess = true;
        }
      });
      if (shouldProcess) {
        processLinks();
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    // Also handle clicks at container level as backup
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Check for our custom data attribute
      const markdownLink = target.closest('[data-markdown-link]');
      if (markdownLink) {
        const markdownFile = markdownLink.getAttribute('data-markdown-link');
        if (markdownFile) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          onChangeTab(markdownFile);
          return false;
        }
      }
      
      // Also check for anchor tags with markdown file hrefs
      const link = target.closest('a');
      if (link) {
        const href = link.getAttribute('href');
        if (href) {
          const markdownFile = findMarkdownFile(href);
          if (markdownFile) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            onChangeTab(markdownFile);
            return false;
          }
        }
      }
    };

    // Use capture phase to catch the event early
    container.addEventListener('click', handleClick, true);
    container.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      const link = target.closest('a[data-markdown-link]');
      if (link) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      observer.disconnect();
      container.removeEventListener('click', handleClick, true);
    };
  }, [content, contentRef, findMarkdownFile, onChangeTab]);

  return (
    <ScrollArea className="h-full">
      <div ref={contentRef} className="markdown-content pr-4 pb-4">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code(props) {
              const { className, children } = props;
              const match = /language-(\w+)/.exec(className || "");
              const language = match ? match[1] : "";
              const isInline = !match;
              
              return !isInline && match ? (
                <SyntaxHighlighter
                  style={(theme === "dark" ? oneDark : oneLight) as Record<string, React.CSSProperties>}
                  language={language}
                  PreTag="div"
                  className="rounded-lg mt-0! mb-4!"
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              ) : (
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground">
                  {children}
                </code>
              );
            },
            a({ href, children, ...props }) {
              // Check if this is a link to another markdown file
              const markdownFile = href ? findMarkdownFile(href) : null;
              
              if (markdownFile) {
                // It's a markdown file - handle click to switch tabs
                // Use a div styled as a link to completely prevent navigation
                const handleClick = (e: React.MouseEvent<HTMLElement>) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                  onChangeTab(markdownFile);
                  return false;
                };
                
                const handleMouseDown = (e: React.MouseEvent<HTMLElement>) => {
                  // Prevent default on mousedown to catch it earlier
                  if (e.button === 0) { // Left click only
                    e.preventDefault();
                    e.stopPropagation();
                  }
                };
                
                const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
                  // Handle Enter and Space for accessibility
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onChangeTab(markdownFile);
                  }
                };
                
                // Use a span styled as a link instead of an anchor to prevent any navigation
                // Also add data attribute for container-level handler
                return (
                  <span
                    role="link"
                    tabIndex={0}
                    data-markdown-link={markdownFile}
                    onClick={handleClick}
                    onMouseDown={handleMouseDown}
                    onKeyDown={handleKeyDown}
                    className="text-primary underline hover:text-primary/80 cursor-pointer"
                    style={{ textDecoration: 'underline' }}
                  >
                    {children}
                  </span>
                );
              }
              
              // External link or non-markdown link - open in new tab
              const isExternal = href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//'));
              return (
                <a
                  href={href}
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noopener noreferrer" : undefined}
                  className="text-primary underline hover:text-primary/80"
                  {...props}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </ScrollArea>
  );
}

export default function AssignmentPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const [files, setFiles] = useState<DocFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // LocalStorage key for persisting active tab
  const STORAGE_KEY = 'assignment-active-tab';

  // Tab change handler with localStorage persistence
  const changeTab = useCallback((filename: string) => {
    // Validate filename exists in files
    const fileExists = files.some(f => f.filename === filename);
    if (!fileExists) {
      return;
    }
    
    setSelectedFile(filename);
    
    // Persist to localStorage
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, filename);
      } catch {
        // Silently fail if localStorage is not available
      }
    }
  }, [files]);

  // Check authentication and admin status
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch("/api/assignment/docs");
        if (response.status === 401 || response.status === 403) {
          router.push("/auth/signin");
          return;
        }
        if (!response.ok) {
          setError("Failed to load documents");
          setLoading(false);
          return;
        }
        const data = await response.json();
        setFiles(data.files);
        
        if (data.files.length > 0) {
          // Try to load from localStorage first
          let initialFile: string | null = null;
          if (typeof window !== 'undefined') {
            try {
              const savedTab = localStorage.getItem(STORAGE_KEY);
              if (savedTab && data.files.some((f: DocFile) => f.filename === savedTab)) {
                initialFile = savedTab;
              }
            } catch {
              // Silently fail if localStorage is not available
            }
          }
          
          // Fallback to first file if no saved tab or saved tab not found
          setSelectedFile(initialFile || data.files[0].filename);
        }
        setLoading(false);
      } catch (err) {
        console.error("Error checking auth:", err);
        setError("Failed to load documents");
        setLoading(false);
      }
    };
    checkAuth();
  }, [router]);

  // Load content when a file is selected
  useEffect(() => {
    if (!selectedFile) return;

    const loadContent = async () => {
      setContentLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/assignment/docs/${selectedFile}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError("File not found");
          } else {
            setError("Failed to load file content");
          }
          setContentLoading(false);
          return;
        }
        const data = await response.json();
        setContent(data.content);
        setContentLoading(false);
        
        // Scroll to top when content changes
        // The ScrollArea component will handle this automatically when content updates
      } catch (err) {
        console.error("Error loading content:", err);
        setError("Failed to load file content");
        setContentLoading(false);
      }
    };

    loadContent();
  }, [selectedFile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error && files.length === 0) {
    return (
      <div className="container mx-auto py-8">
        <PageHeader
          title="Assignment"
          subtitle="View assignment documentation"
        />
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-60px)] overflow-hidden -mx-4 -my-4 md:-mx-6 md:-my-6">
      <div className="shrink-0 px-4 py-4 md:px-6 md:py-6">
        <PageHeader
          title="Assignment"
        />
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">
            This section contains the complete assignment response, including architecture design, implementation details, production readiness analysis, and a guide to using the live demo. Use the left sidebar to navigate between documents.
          </p>
        </div>
      </div>
      
      <div className="flex-1 flex gap-6 px-4 pb-4 md:px-6 md:pb-6 overflow-hidden min-h-0">
        {/* Left sidebar with tabs - fit content */}
        <div className="shrink-0 w-[280px]">
          <Card className="h-fit">
            <CardContent className="p-2">
              {files.map((file) => (
                <Button
                  key={file.filename}
                  variant={selectedFile === file.filename ? "secondary" : "ghost"}
                  className="w-full justify-start mb-1 text-left"
                  onClick={() => changeTab(file.filename)}
                  title={file.name}
                >
                  <span className="truncate block w-full">{file.name}</span>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right content area - fills remaining space */}
        <Card className="flex-1 flex flex-col overflow-hidden min-w-0">
          <CardContent className="p-6 flex-1 overflow-hidden flex flex-col min-h-0">
            {contentLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <MarkdownViewer
                content={content}
                theme={theme}
                onChangeTab={changeTab}
                files={files}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

