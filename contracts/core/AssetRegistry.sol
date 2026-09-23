// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @notice The asset classes that the product can disclose to a receiver.
enum AssetKind {
    EQUITY,
    ETF,
    COMMODITY,
    TREASURY,
    OTHER_RWA
}

/// @notice The independent source used for display valuation.
enum ValuationSource {
    UNDERLYING_ORACLE,
    ISSUER_API,
    POOL_TWAP
}

struct AssetEntry {
    address token;
    AssetKind kind;
    uint8 decimals;
    bool isWrapped;
    address underlying;
    ValuationSource valuation;
    address valuationRef;
    address cashOutRoute;
    bool certified;
    bool enabled;
    string riskTag;
}

/// @notice Governed allowlist for giftable tokenized real-world assets.
/// @dev Certification is an operator assertion backed by the live verification
///      record. The registry keeps that decision separate from escrow logic.
contract AssetRegistry {
    error NotOwner();
    error InvalidOwner();
    error AlreadyRegistered();
    error UnknownAsset();
    error InvalidAsset();
    error CannotEnableUncertifiedAsset();

    event AssetRegistered(
        address indexed token,
        AssetKind kind,
        uint8 decimals,
        bool isWrapped,
        address underlying,
        ValuationSource valuation,
        address valuationRef,
        address cashOutRoute,
        bool certified,
        bool enabled,
        string riskTag
    );
    event AssetCertificationSet(address indexed token, bool certified);
    event AssetEnabledSet(address indexed token, bool enabled);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    address public owner;
    mapping(address token => AssetEntry entry) private _assets;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert InvalidOwner();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function registerAsset(AssetEntry calldata entry) external onlyOwner {
        if (entry.token == address(0)) revert InvalidAsset();
        if (_assets[entry.token].token != address(0)) revert AlreadyRegistered();
        _validateEntry(entry);
        if (entry.enabled && !entry.certified) revert CannotEnableUncertifiedAsset();

        _assets[entry.token] = entry;
        emit AssetRegistered(
            entry.token,
            entry.kind,
            entry.decimals,
            entry.isWrapped,
            entry.underlying,
            entry.valuation,
            entry.valuationRef,
            entry.cashOutRoute,
            entry.certified,
            entry.enabled,
            entry.riskTag
        );
    }

    function setCertified(address token, bool certified) external onlyOwner {
        AssetEntry storage entry = _assets[token];
        if (entry.token == address(0)) revert UnknownAsset();
        entry.certified = certified;
        if (!certified) entry.enabled = false;
        emit AssetCertificationSet(token, certified);
        if (!certified) emit AssetEnabledSet(token, false);
    }

    function setEnabled(address token, bool enabled) external onlyOwner {
        AssetEntry storage entry = _assets[token];
        if (entry.token == address(0)) revert UnknownAsset();
        if (enabled && !entry.certified) revert CannotEnableUncertifiedAsset();
        entry.enabled = enabled;
        emit AssetEnabledSet(token, enabled);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function isGiftable(address token) external view returns (bool) {
        AssetEntry storage entry = _assets[token];
        return entry.token != address(0) && entry.certified && entry.enabled;
    }

    function assetExists(address token) external view returns (bool) {
        return _assets[token].token != address(0);
    }

    function getAsset(address token) external view returns (AssetEntry memory) {
        AssetEntry storage entry = _assets[token];
        if (entry.token == address(0)) revert UnknownAsset();
        return entry;
    }

    function _validateEntry(AssetEntry calldata entry) private pure {
        // An unwrapped asset names itself as its underlying. A wrapped asset
        // must expose a distinct native asset through its wrapper's asset().
        if (entry.isWrapped) {
            if (entry.underlying == address(0) || entry.underlying == entry.token) {
                revert InvalidAsset();
            }
        } else if (entry.underlying != entry.token) {
            revert InvalidAsset();
        }
        if (entry.valuation != ValuationSource.ISSUER_API && entry.valuationRef == address(0)) {
            revert InvalidAsset();
        }
        if (bytes(entry.riskTag).length == 0) revert InvalidAsset();
    }
}
