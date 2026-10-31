import { useState } from 'react';
import type { ComponentDefinition } from '../types.js';
import { NodeFrame } from '../NodeFrame.js';
import type { NodeRenderProps } from '../runtime.js';
import { asBoolean, asString, listItems, safeString } from './define.js';
import { interactionClickHandler } from '../actionHelpers.js';

function fieldId(nodeId: string, name: string): string {
  return `${nodeId}-${name}`;
}

const form: ComponentDefinition = {
  type: 'forms.form',
  version: 1,
  name: 'Form',
  description: 'Accessible form shell that submits through an approved server action.',
  category: 'forms',
  keywords: ['form', 'submit', 'contact', 'input', 'action'],
  defaults: {
    actionId: 'contact',
    submitLabel: 'Send message',
    successMessage: 'Thanks — we received your message.',
    resetOnSuccess: true,
  },
  schema: [
    { key: 'actionId', label: 'Approved action id', group: 'data', control: 'text', required: true, description: 'Must match a server-registered submit action.' },
    { key: 'submitLabel', label: 'Submit label', group: 'content', control: 'text', required: true },
    { key: 'successMessage', label: 'Success message', group: 'content', control: 'textarea' },
    { key: 'resetOnSuccess', label: 'Reset after submit', group: 'advanced', control: 'boolean' },
  ],
  slots: [{ name: 'default', label: 'Fields', accepts: '*', max: 40 }],
  layoutModes: ['stack', 'flow'],
  responsive: true,
  interactive: true,
  source: 'builtin',
  render: ({ node, props, resolved, children, runtime }: NodeRenderProps) => {
    const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const interactive = runtime.interactive;
    return (
      <NodeFrame
        as="form"
        nodeId={node.id}
        layout={{ mode: 'stack', gap: 12, ...resolved.layout }}
        style={resolved.style}
        className={`zc-form zc-form-${status}`}
        ariaLabel={node.a11y?.label}
        onSubmit={(event) => {
          event.preventDefault();
          if (!interactive || status === 'sending') return;
          const formEl = event.currentTarget as HTMLFormElement;
          const data = new FormData(formEl);
          setStatus('sending');
          setMessage('');
          void runtime.actions
            .submit(asString(props.actionId), data)
            .then((result) => {
              if (result.ok) {
                setStatus('ok');
                setMessage(result.message ?? asString(props.successMessage));
                if (asBoolean(props.resetOnSuccess, true)) formEl.reset();
              } else {
                setStatus('error');
                setMessage(result.message ?? 'Something went wrong. Please try again.');
              }
            })
            .catch(() => {
              setStatus('error');
              setMessage('Something went wrong. Please try again.');
            });
        }}
      >
        {children()}
        <div className="zc-form-footer">
          <button type="submit" className="zc-button zc-button-primary" disabled={!interactive || status === 'sending'}>
            {status === 'sending' ? 'Sending…' : asString(props.submitLabel, 'Submit')}
          </button>
          {message ? (
            <p className={`zc-form-message zc-form-message-${status}`} role="status" aria-live="polite">
              {message}
            </p>
          ) : null}
        </div>
      </NodeFrame>
    );
  },
};

const input: ComponentDefinition = {
  type: 'forms.input',
  version: 1,
  name: 'Text field',
  description: 'Single-line input with label, help text, and validation semantics.',
  category: 'forms',
  keywords: ['input', 'text', 'email', 'field', 'form'],
  defaults: { name: 'name', label: 'Name', type: 'text', placeholder: '', required: true, help: '' },
  schema: [
    { key: 'name', label: 'Field name', group: 'data', control: 'text', required: true, description: 'Used as the submitted form key.' },
    { key: 'label', label: 'Label', group: 'content', control: 'text', required: true },
    {
      key: 'type',
      label: 'Input type',
      group: 'content',
      control: 'select',
      options: [
        { value: 'text', label: 'Text' },
        { value: 'email', label: 'Email' },
        { value: 'url', label: 'URL' },
        { value: 'tel', label: 'Telephone' },
        { value: 'password', label: 'Password' },
        { value: 'number', label: 'Number' },
      ],
    },
    { key: 'placeholder', label: 'Placeholder', group: 'content', control: 'text' },
    { key: 'help', label: 'Help text', group: 'content', control: 'text' },
    { key: 'required', label: 'Required', group: 'visibility', control: 'boolean' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  interactive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const name = asString(props.name, 'field');
    const id = fieldId(node.id, name);
    const help = asString(props.help);
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-field">
        <label htmlFor={id} className="zc-field-label">
          {asString(props.label, name)}
          {asBoolean(props.required) ? <span aria-hidden className="zc-field-required"> *</span> : null}
        </label>
        <input
          id={id}
          name={name}
          type={asString(props.type, 'text')}
          placeholder={asString(props.placeholder) || undefined}
          required={asBoolean(props.required)}
          aria-describedby={help ? `${id}-help` : undefined}
          className="zc-input"
        />
        {help ? <p id={`${id}-help`} className="zc-field-help">{help}</p> : null}
      </NodeFrame>
    );
  },
};

const textarea: ComponentDefinition = {
  type: 'forms.textarea',
  version: 1,
  name: 'Text area',
  description: 'Multi-line text input for messages and longer answers.',
  category: 'forms',
  keywords: ['textarea', 'message', 'multiline', 'form'],
  defaults: { name: 'message', label: 'Message', rows: 5, placeholder: '', required: true, help: '' },
  schema: [
    { key: 'name', label: 'Field name', group: 'data', control: 'text', required: true },
    { key: 'label', label: 'Label', group: 'content', control: 'text', required: true },
    { key: 'rows', label: 'Rows', group: 'layout', control: 'range', min: 2, max: 12, step: 1 },
    { key: 'placeholder', label: 'Placeholder', group: 'content', control: 'text' },
    { key: 'help', label: 'Help text', group: 'content', control: 'text' },
    { key: 'required', label: 'Required', group: 'visibility', control: 'boolean' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const name = asString(props.name, 'message');
    const id = fieldId(node.id, name);
    const help = asString(props.help);
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-field">
        <label htmlFor={id} className="zc-field-label">{asString(props.label, name)}</label>
        <textarea
          id={id}
          name={name}
          rows={Math.max(2, Math.min(12, Number(props.rows) || 5))}
          placeholder={asString(props.placeholder) || undefined}
          required={asBoolean(props.required)}
          aria-describedby={help ? `${id}-help` : undefined}
          className="zc-input zc-textarea"
        />
        {help ? <p id={`${id}-help`} className="zc-field-help">{help}</p> : null}
      </NodeFrame>
    );
  },
};

const select: ComponentDefinition = {
  type: 'forms.select',
  version: 1,
  name: 'Select',
  description: 'Dropdown choice field with static options.',
  category: 'forms',
  keywords: ['select', 'dropdown', 'choice', 'form'],
  defaults: {
    name: 'topic',
    label: 'Topic',
    required: false,
    help: '',
    options: [
      { label: 'General', value: 'general' },
      { label: 'Support', value: 'support' },
    ],
  },
  schema: [
    { key: 'name', label: 'Field name', group: 'data', control: 'text', required: true },
    { key: 'label', label: 'Label', group: 'content', control: 'text', required: true },
    { key: 'help', label: 'Help text', group: 'content', control: 'text' },
    { key: 'required', label: 'Required', group: 'visibility', control: 'boolean' },
    {
      key: 'options',
      label: 'Options',
      group: 'content',
      control: 'list',
      maxItems: 30,
      itemDefault: { label: 'Option', value: 'option' },
      itemFields: [
        { key: 'label', label: 'Label', control: 'text', required: true },
        { key: 'value', label: 'Value', control: 'text', required: true },
      ],
    },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const name = asString(props.name, 'choice');
    const id = fieldId(node.id, name);
    const help = asString(props.help);
    const options = listItems(props.options);
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-field">
        <label htmlFor={id} className="zc-field-label">{asString(props.label, name)}</label>
        <select
          id={id}
          name={name}
          required={asBoolean(props.required)}
          aria-describedby={help ? `${id}-help` : undefined}
          className="zc-input zc-select"
        >
          {options.map((option, index) => (
            <option key={`${node.id}-option-${index}`} value={safeString(option.value)}>
              {safeString(option.label)}
            </option>
          ))}
        </select>
        {help ? <p id={`${id}-help`} className="zc-field-help">{help}</p> : null}
      </NodeFrame>
    );
  },
};

const checkbox: ComponentDefinition = {
  type: 'forms.checkbox',
  version: 1,
  name: 'Checkbox',
  description: 'Boolean consent or opt-in field.',
  category: 'forms',
  keywords: ['checkbox', 'consent', 'boolean', 'form'],
  defaults: { name: 'consent', label: 'I agree to the terms', required: false, help: '' },
  schema: [
    { key: 'name', label: 'Field name', group: 'data', control: 'text', required: true },
    { key: 'label', label: 'Label', group: 'content', control: 'text', required: true },
    { key: 'help', label: 'Help text', group: 'content', control: 'text' },
    { key: 'required', label: 'Required', group: 'visibility', control: 'boolean' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  source: 'builtin',
  render: ({ node, props, resolved }: NodeRenderProps) => {
    const name = asString(props.name, 'consent');
    const id = fieldId(node.id, name);
    const help = asString(props.help);
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-field zc-field-inline">
        <input id={id} name={name} type="checkbox" required={asBoolean(props.required)} className="zc-checkbox" />
        <label htmlFor={id} className="zc-field-label">{asString(props.label, name)}</label>
        {help ? <p id={`${id}-help`} className="zc-field-help">{help}</p> : null}
      </NodeFrame>
    );
  },
};

const button: ComponentDefinition = {
  type: 'forms.button',
  version: 1,
  name: 'Button',
  description: 'Form submit or navigation button with interaction bindings.',
  category: 'forms',
  keywords: ['button', 'submit', 'action', 'link'],
  defaults: { label: 'Continue', variant: 'primary', href: '' },
  schema: [
    { key: 'label', label: 'Label', group: 'content', control: 'text', required: true },
    {
      key: 'variant',
      label: 'Variant',
      group: 'style',
      control: 'select',
      options: [
        { value: 'primary', label: 'Primary' },
        { value: 'secondary', label: 'Secondary' },
        { value: 'ghost', label: 'Ghost' },
      ],
    },
    { key: 'href', label: 'Fallback link', group: 'content', control: 'url', description: 'Used when no click interaction is bound.' },
  ],
  slots: [],
  layoutModes: ['flow'],
  responsive: true,
  interactive: true,
  source: 'builtin',
  render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
    const onClick = interactionClickHandler(runtime, node);
    const href = asString(props.href);
    const handler =
      onClick ?? (href && runtime.interactive ? () => runtime.actions.navigate(href) : undefined);
    return (
      <NodeFrame nodeId={node.id} layout={resolved.layout} style={resolved.style} className="zc-button-wrap">
        <button
          type="button"
          className={`zc-button zc-button-${asString(props.variant, 'primary')}`}
          onClick={handler}
        >
          {asString(props.label, 'Continue')}
        </button>
      </NodeFrame>
    );
  },
};

export const formComponents: ComponentDefinition[] = [form, input, textarea, select, checkbox, button];
