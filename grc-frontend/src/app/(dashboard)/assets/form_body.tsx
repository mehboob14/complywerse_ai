<div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Row 1: Name + Description */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Description</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  placeholder="Brief description..."
                />
              </div>
            </div>

            {/* Asset Type */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">Asset Type *</label>
              <div className="grid grid-cols-3 gap-1.5">
                {ASSET_TYPES.map((type) => {
                  const Icon = type.icon;
                  const isSelected = formData.asset_type === type.value;
                  return (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => {
                        const nextType = type.value as AssetType;
                        const nextComponentSuggestions = ASSET_COMPONENT_SUGGESTIONS[nextType] || [];
                        const keepCurrentComponent = nextComponentSuggestions.includes(formData.component);
                        setFormData({
                          ...formData,
                          asset_type: nextType,
                          component: keepCurrentComponent ? formData.component : '',
                          sub_components: keepCurrentComponent ? formData.sub_components : [],
                        });
                      }}
                      className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className={`h-4 w-4 flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`} />
                      <span className={`text-xs font-medium truncate ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                        {type.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Row: Primary Component + IP Address */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">Primary Component</label>
                <select
                  value={formData.component}
                  onChange={(e) => setFormData({ ...formData, component: e.target.value, sub_components: [] })}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select component</option>
                  {componentSuggestions.map((component) => (
                    <option key={component} value={component}>{component}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-0.5">IP Address</label>
                <input
                  type="text"
                  value={formData.ip_address}
                  onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g., 10.0.10.15"
                />
              </div>
            </div>

            {/* Sub-components */}
            {subComponentSuggestions.length > 0 && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-600 mb-1">Sub-components</label>
                <div className="flex flex-wrap gap-1.5">
                  {subComponentSuggestions.map((subComponent) => {
                    const isSelected = formData.sub_components.includes(subComponent);
                    return (
                      <button
                        key={subComponent}
                        type="button"
                        onClick={() => toggleSubComponent(subComponent)}
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                          isSelected
                            ? 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {subComponent}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Custom sub-component */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-0.5">Custom Sub-component</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customSubComponent}
                  onChange={(e) => setCustomSubComponent(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  placeholder="e.g., WiFi Controller"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomSubComponent(); } }}
                />
                <button type="button" onClick={addCustomSubComponent} className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
                  Add
                </button>
              </div>
              {formData.sub_components.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {formData.sub_components.map((subComponent) => (
                    <span key={subComponent} className="inline-flex items-center gap-1 rounded-full border border-blue-400 bg-blue-50 px-2.5 py-0.5 text-xs text-blue-700">
                      {subComponent}
                      <button type="button" onClick={() => toggleSubComponent(subComponent)} className="text-blue-500 hover:text-blue-700" aria-label={`Remove ${subComponent}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 pt-3 mt-1">
              {/* Row: Vendor + Location */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Vendor</label>
                  <input
                    type="text"
                    value={formData.vendor}
                    onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    placeholder="e.g., Microsoft, AWS"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Location</label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    placeholder="e.g., US-East, On-Premise"
                  />
                </div>
              </div>

              {/* Row: Criticality + Asset Value */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Criticality</label>
                  <select
                    value={formData.criticality}
                    onChange={(e) => setFormData({ ...formData, criticality: e.target.value as typeof formData.criticality })}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Asset Value (USD)</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number"
                      value={formData.valuation || ''}
                      onChange={(e) => setFormData({ ...formData, valuation: e.target.value ? Number(e.target.value) : null })}
                      className="w-full rounded border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                      placeholder="0"
                      min="0"
                    />
                  </div>
                </div>
              </div>

              {/* Row: PCI DSS + Status(edit) */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">PCI DSS Scope</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, cde_environment: !formData.cde_environment })}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        formData.cde_environment ? 'bg-emerald-500' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                          formData.cde_environment ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-xs text-slate-700">CDE Environment</span>
                  </label>
                </div>
                {isEditMode && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-0.5">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as typeof formData.status })}
                      className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="decommissioned">Decommissioned</option>
                    </select>
                  </div>
                )}
              </div>

              {/* CIA Ratings */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">CIA Ratings</label>
                <div className="grid grid-cols-3 gap-3">
                  <RatingSelector
                    label="Confidentiality"
                    value={formData.confidentiality_rating}
                    onChange={(v) => setFormData({ ...formData, confidentiality_rating: v })}
                    color="bg-blue-600"
                  />
                  <RatingSelector
                    label="Integrity"
                    value={formData.integrity_rating}
                    onChange={(v) => setFormData({ ...formData, integrity_rating: v })}
                    color="bg-green-600"
                  />
                  <RatingSelector
                    label="Availability"
                    value={formData.availability_rating}
                    onChange={(v) => setFormData({ ...formData, availability_rating: v })}
                    color="bg-yellow-600"
                  />
                </div>
              </div>
            </div>
          </div>