'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

interface AutoCompleteProps {
  value?: string
  onChange?: (value: string) => void
  onSearch?: (value: string, bypassCache?: boolean, allowFuzzy?: boolean) => void
  tenantSlug?: string
  className?: string
  placeholder?: string
  onBypassCacheChange?: (checked: boolean) => void
  bypassCache?: boolean
  onAllowFuzzyChange?: (checked: boolean) => void
  allowFuzzy?: boolean
  isLoading?: boolean
}

export default function SearchAutocomplete({ 
  value = '', 
  onChange,
  onSearch,
  tenantSlug,
  className,
  placeholder = "Search documents...",
  onBypassCacheChange,
  bypassCache = false,
  onAllowFuzzyChange,
  allowFuzzy = false,
  isLoading = false,
}: AutoCompleteProps) {
  const router = useRouter()
  const [query, setQuery] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuery(value)
  }, [value])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setQuery(newValue)
    onChange?.(newValue)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Use the current input value (most up-to-date)
      const currentValue = e.currentTarget.value.trim()
      if (currentValue) {
        handleSearch(currentValue)
      }
    }
  }

  const handleSearch = (searchValue?: string) => {
    // Use provided value, or current query state, or input value
    const valueToSearch = searchValue || query || inputRef.current?.value || ''
    const trimmedValue = valueToSearch.trim()
    
    if (trimmedValue) {
      // Update local state if using input value
      if (searchValue || inputRef.current?.value) {
        setQuery(trimmedValue)
        onChange?.(trimmedValue)
      }
      
      if (onSearch) {
        onSearch(trimmedValue, bypassCache, allowFuzzy)
      } else {
        const params = new URLSearchParams({
          q: trimmedValue,
          ...(tenantSlug && { tenant: tenantSlug }),
          ...(bypassCache && { bypassCache: 'true' }),
          ...(allowFuzzy && { allowFuzzy: 'true' }),
        })
        router.push(`/dashboard/documents?${params}`)
      }
    }
  }

  const handleBypassChange = (checked: boolean) => {
    onBypassCacheChange?.(checked)
  }

  const handleAllowFuzzyChange = (checked: boolean) => {
    onAllowFuzzyChange?.(checked)
  }

  return (
    <div className={cn("relative w-full", className)}>
      <div className="flex flex-col gap-3">
        {/* Search input */}
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
          <Input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="pl-10 pr-4 w-full"
            aria-label="Search input"
          />
        </div>

        {/* Bypass cache checkbox */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="bypass-cache"
            checked={bypassCache}
            onCheckedChange={(checked) => handleBypassChange(checked === true)}
          />
          <Label
            htmlFor="bypass-cache"
            className="text-sm font-normal cursor-pointer"
          >
            Bypass query caching
          </Label>
        </div>

        {/* Allow fuzzy search checkbox */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="allow-fuzzy"
            checked={allowFuzzy}
            onCheckedChange={(checked) => handleAllowFuzzyChange(checked === true)}
          />
          <Label
            htmlFor="allow-fuzzy"
            className="text-sm font-normal cursor-pointer"
          >
            Allow fuzzy search
          </Label>
        </div>

        {/* Search button */}
        <Button
          onClick={() => handleSearch()}
          disabled={!query.trim() || isLoading}
          aria-label="Search"
          type="button"
          className="w-full"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Searching...
            </>
          ) : (
            <>
              <Search className="h-4 w-4 mr-2" />
              Search
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

