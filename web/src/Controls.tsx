import { useId, type ReactNode } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function Select({
  value,
  onValueChange,
  options,
  label,
  placeholder = '请选择',
  disabled = false,
  required = false,
  name,
  className = '',
}: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  label: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  name?: string
  className?: string
}) {
  // Radix reserves the empty string for placeholders; an empty option remains selectable.
  const emptyValue = useId()
  const encoded = value || (options.some((o) => o.value === '') ? emptyValue : '')
  return (
    <SelectPrimitive.Root
      value={encoded}
      onValueChange={(v) => onValueChange(v === emptyValue ? '' : v)}
      disabled={disabled || options.length === 0}
      required={required}
      name={name}
    >
      <SelectPrimitive.Trigger className={'ui-select ' + className} aria-label={label}>
        <span className="ui-select-value">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon className="ui-select-icon">
          <ChevronDown size={17} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="ui-select-menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <SelectPrimitive.ScrollUpButton className="ui-select-scroll">
            <ChevronUp size={16} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="ui-select-options">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value || emptyValue}
                disabled={o.disabled}
                className="ui-select-option"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ui-select-check">
                  <Check size={16} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="ui-select-scroll">
            <ChevronDown size={16} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export function Checkbox({
  checked,
  onCheckedChange,
  children,
  disabled = false,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <label className="ui-checkbox" data-disabled={disabled || undefined}>
      <input
        className="ui-checkbox-input"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <span className="ui-checkbox-box" aria-hidden="true">
        <Check size={14} strokeWidth={2.8} />
      </span>
      <span className="ui-checkbox-label">{children}</span>
    </label>
  )
}
