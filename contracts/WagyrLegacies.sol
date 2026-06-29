// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Pausable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import {ERC721Royalty} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract WagyrLegacies is ERC721URIStorage, ERC721Royalty, ERC721Pausable, AccessControl, ReentrancyGuard, EIP712 {
    enum Tier {
        Genesis,
        Legacy,
        EternalPatron
    }

    struct LegacyData {
        Tier tier;
        uint256 playerId;
        uint256 backedAmount;
        uint256 patronSlot;
        address originalClaimer;
        uint256 mintTimestamp;
        bool rebateEligible;
    }

    struct MintRequest {
        address user;
        Tier tier;
        uint256 playerId;
        uint256 backedAmount;
        uint256 patronSlot;
        string metadataURI;
        uint256 nonce;
        uint256 expiry;
    }

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    uint256 public constant PATRON_CAP = 100;
    uint256 public constant LEGACY_THRESHOLD = 100 ether;
    uint256 public constant ETERNAL_PATRON_THRESHOLD = 1_000 ether;

    bytes32 public constant MINT_REQUEST_TYPEHASH = keccak256(
        "MintRequest(address user,uint8 tier,uint256 playerId,uint256 backedAmount,uint256 patronSlot,string metadataURI,uint256 nonce,uint256 expiry)"
    );

    mapping(uint256 tokenId => LegacyData data) public legacyData;
    mapping(address user => mapping(uint256 nonce => bool used)) public usedNonces;
    mapping(uint256 playerId => uint256 count) public patronMintCount;

    address public treasury;
    address public buyback;
    uint256 public claimFee;

    uint256 private _nextTokenId = 1;

    event LegacyMinted(
        address indexed user,
        uint256 indexed tokenId,
        Tier tier,
        uint256 indexed playerId,
        uint256 backedAmount,
        uint256 patronSlot,
        bool rebateEligible
    );
    event ClaimUsed(bytes32 indexed claimHash, address indexed user, uint256 indexed nonce);
    event PatronSlotAssigned(uint256 indexed playerId, uint256 slot, uint256 indexed tokenId);
    event MetadataURIAssigned(uint256 indexed tokenId, string metadataURI);
    event FeeSplit(uint256 treasuryAmount, uint256 buybackAmount);
    event SignerUpdated(address indexed signer, bool enabled);
    event FeeRecipientsUpdated(address indexed treasury, address indexed buyback);
    event ClaimFeeUpdated(uint256 oldFee, uint256 newFee);
    event DefaultRoyaltyUpdated(address indexed receiver, uint96 feeNumerator);

    error AddressZero();
    error ClaimExpired(uint256 expiry);
    error FeeTransferFailed(address recipient, uint256 amount);
    error IncorrectClaimFee(uint256 expected, uint256 actual);
    error InvalidBackedAmount(uint256 backedAmount, uint256 requiredAmount);
    error InvalidClaimUser(address expected, address actual);
    error InvalidMetadataURI();
    error InvalidPatronSlot(uint256 expected, uint256 actual);
    error InvalidPlayerId();
    error InvalidSignature(address recoveredSigner);
    error NonceAlreadyUsed(address user, uint256 nonce);
    error UnsupportedTier(uint8 tier);

    constructor(
        address admin,
        address initialSigner,
        address initialTreasury,
        address initialBuyback,
        address royaltyReceiver,
        uint96 royaltyFeeNumerator,
        uint256 initialClaimFee
    ) ERC721("Wagyr Legacies", "WAGYR") EIP712("WagyrLegacies", "1") {
        _requireNonZero(admin);
        _requireNonZero(initialSigner);
        _requireNonZero(initialTreasury);
        _requireNonZero(initialBuyback);
        _requireNonZero(royaltyReceiver);

        treasury = initialTreasury;
        buyback = initialBuyback;
        claimFee = initialClaimFee;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(SIGNER_ROLE, initialSigner);
        _setDefaultRoyalty(royaltyReceiver, royaltyFeeNumerator);

        emit SignerUpdated(initialSigner, true);
        emit FeeRecipientsUpdated(initialTreasury, initialBuyback);
        emit ClaimFeeUpdated(0, initialClaimFee);
        emit DefaultRoyaltyUpdated(royaltyReceiver, royaltyFeeNumerator);
    }

    function claim(
        MintRequest calldata request,
        bytes calldata signature
    ) external payable nonReentrant whenNotPaused returns (uint256 tokenId) {
        if (request.user != msg.sender) {
            revert InvalidClaimUser(request.user, msg.sender);
        }
        if (block.timestamp > request.expiry) {
            revert ClaimExpired(request.expiry);
        }
        if (usedNonces[request.user][request.nonce]) {
            revert NonceAlreadyUsed(request.user, request.nonce);
        }
        if (!_isValidIpfsURI(request.metadataURI)) {
            revert InvalidMetadataURI();
        }
        if (msg.value != claimFee) {
            revert IncorrectClaimFee(claimFee, msg.value);
        }

        bytes32 claimHash = hashMintRequest(request);
        address recoveredSigner = ECDSA.recover(claimHash, signature);
        if (!hasRole(SIGNER_ROLE, recoveredSigner)) {
            revert InvalidSignature(recoveredSigner);
        }

        uint256 patronSlot = _validateTierRequirements(request);
        bool rebateEligible = request.tier == Tier.EternalPatron;

        usedNonces[request.user][request.nonce] = true;
        emit ClaimUsed(claimHash, request.user, request.nonce);

        _splitFee(msg.value);

        tokenId = _nextTokenId++;
        if (rebateEligible) {
            patronMintCount[request.playerId] = patronSlot;
        }

        legacyData[tokenId] = LegacyData({
            tier: request.tier,
            playerId: request.playerId,
            backedAmount: request.backedAmount,
            patronSlot: patronSlot,
            originalClaimer: request.user,
            mintTimestamp: block.timestamp,
            rebateEligible: rebateEligible
        });

        _safeMint(request.user, tokenId);
        _setTokenURI(tokenId, request.metadataURI);

        if (rebateEligible) {
            emit PatronSlotAssigned(request.playerId, patronSlot, tokenId);
        }
        emit MetadataURIAssigned(tokenId, request.metadataURI);
        emit LegacyMinted(
            request.user,
            tokenId,
            request.tier,
            request.playerId,
            request.backedAmount,
            patronSlot,
            rebateEligible
        );
    }

    function setClaimFee(uint256 newClaimFee) external onlyRole(ADMIN_ROLE) {
        uint256 oldClaimFee = claimFee;
        claimFee = newClaimFee;
        emit ClaimFeeUpdated(oldClaimFee, newClaimFee);
    }

    function setFeeRecipients(address newTreasury, address newBuyback) external onlyRole(ADMIN_ROLE) {
        _requireNonZero(newTreasury);
        _requireNonZero(newBuyback);

        treasury = newTreasury;
        buyback = newBuyback;
        emit FeeRecipientsUpdated(newTreasury, newBuyback);
    }

    function setSigner(address signer, bool enabled) external onlyRole(ADMIN_ROLE) {
        _requireNonZero(signer);

        if (enabled) {
            _grantRole(SIGNER_ROLE, signer);
        } else {
            _revokeRole(SIGNER_ROLE, signer);
        }
        emit SignerUpdated(signer, enabled);
    }

    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyRole(ADMIN_ROLE) {
        _requireNonZero(receiver);
        _setDefaultRoyalty(receiver, feeNumerator);
        emit DefaultRoyaltyUpdated(receiver, feeNumerator);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function hashMintRequest(MintRequest calldata request) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                MINT_REQUEST_TYPEHASH,
                request.user,
                uint8(request.tier),
                request.playerId,
                request.backedAmount,
                request.patronSlot,
                keccak256(bytes(request.metadataURI)),
                request.nonce,
                request.expiry
            )
        );

        return _hashTypedDataV4(structHash);
    }

    function remainingPatronSlots(uint256 playerId) external view returns (uint256) {
        return PATRON_CAP - patronMintCount[playerId];
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function tokenURI(
        uint256 tokenId
    ) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return ERC721URIStorage.tokenURI(tokenId);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721URIStorage, ERC721Royalty, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721, ERC721Pausable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _validateTierRequirements(MintRequest calldata request) private view returns (uint256 patronSlot) {
        if (request.tier == Tier.Genesis) {
            if (request.backedAmount == 0) {
                revert InvalidBackedAmount(request.backedAmount, 1);
            }
            if (request.patronSlot != 0) {
                revert InvalidPatronSlot(0, request.patronSlot);
            }
            return 0;
        }

        if (request.tier == Tier.Legacy) {
            if (request.backedAmount < LEGACY_THRESHOLD) {
                revert InvalidBackedAmount(request.backedAmount, LEGACY_THRESHOLD);
            }
            if (request.patronSlot != 0) {
                revert InvalidPatronSlot(0, request.patronSlot);
            }
            return 0;
        }

        if (request.tier == Tier.EternalPatron) {
            if (request.playerId == 0) {
                revert InvalidPlayerId();
            }
            if (request.backedAmount < ETERNAL_PATRON_THRESHOLD) {
                revert InvalidBackedAmount(request.backedAmount, ETERNAL_PATRON_THRESHOLD);
            }

            uint256 expectedSlot = patronMintCount[request.playerId] + 1;
            if (expectedSlot > PATRON_CAP) {
                revert InvalidPatronSlot(PATRON_CAP, request.patronSlot);
            }
            if (request.patronSlot != expectedSlot) {
                revert InvalidPatronSlot(expectedSlot, request.patronSlot);
            }
            return request.patronSlot;
        }

        revert UnsupportedTier(uint8(request.tier));
    }

    function _splitFee(uint256 amount) private {
        uint256 treasuryAmount = amount / 2;
        uint256 buybackAmount = amount - treasuryAmount;

        if (treasuryAmount > 0) {
            _sendValue(treasury, treasuryAmount);
        }
        if (buybackAmount > 0) {
            _sendValue(buyback, buybackAmount);
        }

        emit FeeSplit(treasuryAmount, buybackAmount);
    }

    function _sendValue(address recipient, uint256 amount) private {
        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) {
            revert FeeTransferFailed(recipient, amount);
        }
    }

    function _isValidIpfsURI(string calldata uri) private pure returns (bool) {
        bytes calldata uriBytes = bytes(uri);
        return
            uriBytes.length > 7 &&
            uriBytes[0] == bytes1("i") &&
            uriBytes[1] == bytes1("p") &&
            uriBytes[2] == bytes1("f") &&
            uriBytes[3] == bytes1("s") &&
            uriBytes[4] == bytes1(":") &&
            uriBytes[5] == bytes1("/") &&
            uriBytes[6] == bytes1("/");
    }

    function _requireNonZero(address account) private pure {
        if (account == address(0)) {
            revert AddressZero();
        }
    }
}
